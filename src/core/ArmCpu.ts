const enum ArmCpuModel {
    ARM7 = 0,
    ARM9 = 1,
}

const enum ArmCpuMode {
    OldUSR = 0x00,
    OldFIQ = 0x01,
    OldIRQ = 0x02,
    OldSVC = 0x03,

    USR = 0x10, // User
    FIQ = 0x11, // Fast Interrupt Request
    IRQ = 0x12, // Interrupt Request
    SVC = 0x13, // Supervisor Call
    ABT = 0x17, // Abort
    UND = 0x1B, // Undefined Instruction
    SYS = 0x1F, // System
}

const enum CpsrFlag {
    Negative = 1 << 31,
    Zero = 1 << 30,
    Carry = 1 << 29,
    Overflow = 1 << 28,

    IRQDisable = 1 << 7,
    FIQDisable = 1 << 6,
    Thumb = 1 << 5,
}

function rotateRight32(val: number, bits: number): number {
    return (val >> bits) | (val << -bits);
}

function arithmeticShiftRight32(val: number, bits: number): number {
    return val >> bits;
}

function logicalShiftLeft32(val: number, bits: number): number {
    return val << bits;
}

function logicalShiftRight32(val: number, bits: number): number {
    return val >>> bits;
}

function checkOverflowSub(val1: number, val2: number, result: number): boolean {
    return ((val1 ^ val2) & ((val1 ^ result)) & 0x80000000) != 0;
}

function checkOverflowAdd(val1: number, val2: number, result: number): boolean {
    return (~(val1 ^ val2) & ((val1 ^ result)) & 0x80000000) != 0;
}

function checkBinaryMask(val: number, mask: string) {
    for (let i = mask.length - 1; i >= 0; i--) {
        if (mask.charAt(i) == 'x') {
            val >>= 1;
            continue;
        } else if (mask.charAt(i) == '0') {
            if ((val & 1) == 0) {
                val >>= 1;
                continue;
            } else {
                return false;
            }
        } else if (mask.charAt(i) == '1') {
            if ((val & 1) == 1) {
                val >>= 1;
                continue;
            } else {
                return false;
            }
        } else {
            throw new Error("Invalid character in mask");
        }
    }

    return true;
}

type ArmExecutor = (this: ArmCpu, ins: number) => void;

function armBranch(this: ArmCpu, ins: number) {
    let offset = (ins & 0b111111111111111111111111) << 2;
    offset = (offset << 6) >> 6; // Sign extend

    // Branch with Link (BL) - store return address in R14
    if (bitTest(ins, 24)) {
        this.r[14] = this.r[15] - 4;
    }

    this.armSetReg(15, this.r[15] + offset);
}

function armBranchWithExchange(this: ArmCpu, ins: number) {
    let rm = ins & 0xF;
    let rmValue = this.r[rm];

    this.cpsrThumbState = bitTest(rmValue, 0);

    // BLX register
    let opcode = (ins >> 4) & 0xF;
    if (opcode == 0b0011) {
        this.r[14] = this.r[15] - 4;
    }

    this.r[15] = rmValue & ~1;
    this.flushPipeline();
}


function armMsrRegister(this: ArmCpu, ins: number) {
    let useSPSR = bitTest(ins, 22);

    let setControl = bitTest(ins, 16);
    let setExtension = bitTest(ins, 17);
    let setStatus = bitTest(ins, 18);
    let setFlags = bitTest(ins, 19);

    let useImmediate = bitTest(ins, 25);

    let operand;

    if (useImmediate) {
        let rotateBits = ((ins >> 8) & 0xF) << 2;
        let constant = ins & 0xFF;

        operand = rotateRight32(constant, rotateBits);
    }
    else {
        operand = this.r[ins & 0xF];
    }

    let byteMask =
        (setControl ? 0x000000FF : 0) |
        (setExtension ? 0x0000FF00 : 0) |
        (setStatus ? 0x00FF0000 : 0) |
        (setFlags ? 0xFF000000 : 0);

    if (!useSPSR) {
        // TODO: Fix privileged mode functionality in CPSR MSR
        if (this.mode == ArmCpuMode.USR) {
            // Privileged
            byteMask &= 0xFF000000;
        }
        this.setCpsr((this.getCpsr() & ~byteMask) | (operand & byteMask));
    }
    else {
        // TODO: Add SPSR functionality to MSR
        this.setCpsr((this.getCpsr() & ~byteMask) | (operand & byteMask));
    }
}

function generateArmDataProcessing(ins: number) {
    let opcode = (ins >> 21) & 0xF;
    let setFlags = bitTest(ins, 20);
    return function (this: ArmCpu, ins: number) {
        let rn = (ins >> 16) & 0xF;

        let rd = (ins >> 12) & 0xF;
        let rnVal = this.r[rn];
        let shifterOperand = 0;
        let shifterCarryOut = false;

        if (bitTest(ins, 25)) {
            // Use 32-bit Immediate
            let rotateBits = ((ins >> 8) & 0xF) << 1;
            let constant = ins & 0xFF;

            shifterOperand = rotateRight32(constant, rotateBits);
            if (rotateBits == 0) {
                shifterCarryOut = this.cpsrCarry;
            } else {
                shifterCarryOut = bitTest(shifterOperand, 31);
            }
        } else {
            // Use Register
            let regShift = bitTest(ins, 4);

            let shiftBits;
            let shiftType = (ins >> 5) & 0b11;

            if (!regShift) {
                // Shift by Immediate
                shiftBits = (ins >> 7) & 0b11111;

                let rm = ins & 0xF;
                let rmVal = this.r[rm];

                switch (shiftType) {
                    case 0b00: // LSL
                        if (shiftBits == 0) {
                            shifterOperand = rmVal;
                            shifterCarryOut = this.cpsrCarry;
                        }
                        else {
                            shifterOperand = logicalShiftLeft32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, 32 - shiftBits);
                        }
                        break;
                    case 0b01: // LSR
                        if (shiftBits == 0) {
                            shifterOperand = 0;
                            shifterCarryOut = bitTest(rmVal, 31);
                        }
                        else {
                            shifterOperand = logicalShiftRight32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, shiftBits - 1);
                        }
                        break;
                    case 0b10: // ASR
                        if (shiftBits == 0) {
                            shifterOperand = rmVal >> 31;
                            shifterCarryOut = bitTest(rmVal, 31);
                        }
                        else {
                            shifterOperand = arithmeticShiftRight32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, shiftBits - 1);
                        }
                        break;
                    case 0b11: // ROR
                        if (shiftBits == 0) {
                            shifterOperand = logicalShiftLeft32(+this.cpsrCarry, 31) | logicalShiftRight32(rmVal, 1);
                            shifterCarryOut = bitTest(rmVal, 0);
                        }
                        else {
                            shifterOperand = rotateRight32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, shiftBits - 1);
                        }
                        break;
                }
            } else {
                // Shift by Register

                let rs = (ins >> 8) & 0xF;
                let rm = ins & 0xF;

                this.r[15] += 4;
                let rsVal = this.r[rs];
                let rmVal = this.r[rm];
                this.r[15] -= 4;

                shiftBits = rsVal;

                switch (shiftType) {
                    case 0b00:
                        if (shiftBits == 0) {
                            shifterOperand = rmVal;
                            shifterCarryOut = this.cpsrCarry;
                            break;
                        }

                        if (shiftBits >= 32) {
                            if (shiftBits > 32) {
                                shifterCarryOut = false;
                            }
                            else {
                                shifterCarryOut = bitTest(rmVal, 0);
                            }
                            shifterOperand = 0;
                            break;
                        }

                        shifterOperand = rmVal << shiftBits;
                        shifterCarryOut = bitTest(rmVal, 32 - shiftBits);
                        break;
                    case 0b01:
                        if (shiftBits == 0) {
                            shifterOperand = rmVal;
                            shifterCarryOut = this.cpsrCarry;
                        }
                        else if (shiftBits < 32) {
                            shifterOperand = logicalShiftRight32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, shiftBits - 1);
                        }
                        else if (shiftBits == 32) {
                            shifterOperand = 0;
                            shifterCarryOut = bitTest(rmVal, 31);
                        }
                        else {
                            shifterOperand = 0;
                            shifterCarryOut = false;
                        }
                        break;
                    case 0b10:
                        if (shiftBits == 0) {
                            shifterOperand = rmVal;
                            shifterCarryOut = this.cpsrCarry;
                        }
                        else if (shiftBits < 32) {
                            shifterOperand = arithmeticShiftRight32(rmVal, shiftBits);
                            shifterCarryOut = bitTest(rmVal, shiftBits - 1);
                        }
                        else if (shiftBits >= 32) {
                            shifterOperand = rmVal >> 31;
                            shifterCarryOut = bitTest(rmVal, 31);
                        }
                        break;
                    case 0b11:
                        if (shiftBits == 0) {
                            shifterOperand = rmVal;
                            shifterCarryOut = this.cpsrCarry;
                        }
                        else {
                            shifterOperand = rotateRight32(rmVal, shiftBits & 0b11111);
                            shifterCarryOut = bitTest(rmVal, shiftBits & 0b11111 - 1);
                        }
                        break;
                }
            }
        }

        switch (opcode) {
            case 0x0:
                throw new Error("Unimplemented AND");
            case 0x1:
                throw new Error("Unimplemented EOR");
            case 0x2:
                throw new Error("Unimplemented SUB");
            case 0x3:
                throw new Error("Unimplemented RSB");
            case 0x4:
                let final = rnVal + shifterOperand;
                if (setFlags) {
                    this.cpsrNegative = bitTest(final, 31); // N
                    this.cpsrZero = final == 0; // Z
                    this.cpsrCarry = rnVal + shifterOperand > 0xFFFFFFFF; // C
                    this.cpsrOverflow = checkOverflowAdd(rnVal, shifterOperand, final); // C

                    if (rd == 15) {
                        this.setCpsr(this.getSpsr());
                    }
                }
                this.armSetReg(rd, final);
                break;
            case 0x5:
                throw new Error("Unimplemented ADC");
            case 0x6:
                throw new Error("Unimplemented SBC");
            case 0x7:
                throw new Error("Unimplemented RSC");
            case 0x8:
                throw new Error("Unimplemented TST");
            case 0x9:
                throw new Error("Unimplemented TEQ");
            case 0xA:
                throw new Error("Unimplemented CMP");
            case 0xB:
                throw new Error("Unimplemented CMN");
            case 0xC:
                throw new Error("Unimplemented ORR");
            case 0xD:
                if (setFlags) {
                    this.cpsrNegative = bitTest(shifterOperand, 31);
                    this.cpsrZero = shifterOperand == 0;
                    this.cpsrCarry = shifterCarryOut;
                }

                this.armSetReg(rd, shifterOperand);
                break;
            case 0xE:
                throw new Error("Unimplemented BIC");
            case 0xF:
                throw new Error("Unimplemented MVN");
            default:
                throw new Error("This shouldn't happen");
        }
    };
}

function generateArmRegularLdrStr(ins: number) {
    let useRegisterOffset = bitTest(ins, 25);
    let p = bitTest(ins, 24); // post-indexed / offset addressing 
    let u = bitTest(ins, 23); // invert
    let b = bitTest(ins, 22);
    let w = bitTest(ins, 21);
    let l = bitTest(ins, 20);

    return function (this: ArmCpu, ins: number) {
        let rn = (ins >> 16) & 0xF;
        let rd = (ins >> 12) & 0xF;
        let rnVal = this.r[rn];

        let offset = 0;

        if (useRegisterOffset) {
            let rmVal = this.r[ins & 0xF];

            if ((ins & 0b111111110000) == 0b000000000000) {
                offset = rmVal;
            }
            else {
                let shiftType = (ins >> 5) & 0b11;
                let shiftBits = (ins >> 7) & 0b11111;
                switch (shiftType) {
                    case 0b00:
                        offset = logicalShiftLeft32(rmVal, shiftBits);
                        break;
                    case 0b01:
                        if (shiftBits == 0) {
                            offset = 0;
                        }
                        else {
                            offset = logicalShiftRight32(rmVal, shiftBits);
                        }
                        break;
                    case 0b10:
                        if (shiftBits == 0) {
                            offset = rmVal >> 31;
                        }
                        else {
                            offset = arithmeticShiftRight32(rmVal, shiftBits);
                        }
                        break;
                    default:
                    case 0b11:
                        if (shiftBits == 0) {
                            offset = logicalShiftLeft32(+this.cpsrCarry, 31) | (logicalShiftRight32(rmVal, 1));
                        }
                        else {
                            offset = rotateRight32(rmVal, shiftBits);
                        }
                        break;
                }
            }
        } else {
            offset = ins & 0b111111111111;
        }

        let addr = rnVal;
        if (p) {
            if (u) {
                addr += offset;
            } else {
                addr -= offset;
            }
            addr &= 0xFFFFFFFF;
        }

        if (l) {
            let loadVal = 0;
            if (b) {
                loadVal = this.memory.read8(addr);
            } else {
                if ((addr & 0b11) != 0) {
                    throw new Error("Misaligned address");
                } else {
                    loadVal = this.memory.read32(addr);
                }
            }

            if (!p) {
                if (u) {
                    addr += offset;
                }
                else {
                    addr -= offset;
                }
                addr &= 0xFFFFFFFF;

                this.r[rn] = addr;
            }
            else if (w) {
                this.r[rn] = addr;
            }

            // Register loading happens after writeback, so if writeback register and Rd are the same, 
            // the writeback value would be overwritten by Rd.
            this.armSetReg(rd, loadVal);
        } else {
            this.r[15] += 4;

            let storeVal = this.r[rd];
            if (b) {
                this.memory.write8(addr, storeVal);
            }
            else {
                this.memory.write32(addr & 0xFFFFFFFC, storeVal);
            }

            this.r[15] -= 4;

            if (!p) {
                if (u) {
                    addr += offset;
                }
                else {
                    addr -= offset;
                }
                addr &= 0xFFFFFFFF;

                this.r[rn] = addr;
            }
            else if (w) {
                this.r[rn] = addr;
            }
        }
    };
}

function thumbLdrLiteralPool(this: ArmCpu, ins: number) {
    let rd = (ins >> 8) & 0b111;
    let immed8 = (ins >> 0) & 0xFF;

    let addr = (this.r[15] & 0xFFFFFFFC) + (immed8 << 2);

    let readAddr = addr & ~0b11;
    let readVal = this.memory.read32(readAddr);
    this.r[rd] = rotateRight32(readVal, (addr & 0b11) << 3);
}

function generateThumbDataProcessing(ins: number) {
    let opcode = (ins >> 6) & 0xF;
    return function (this: ArmCpu, ins: number) {
        switch (opcode) {
            case 0x0:
                throw new Error("Unimplemented AND");
            case 0x1:
                throw new Error("Unimplemented EOR");
            case 0x2:
                throw new Error("Unimplemented SUB");
            case 0x3:
                throw new Error("Unimplemented RSB");
            case 0x4:
                throw new Error("Unimplemented ADD");
            case 0x5:
                throw new Error("Unimplemented ADC");
            case 0x6:
                throw new Error("Unimplemented SBC");
            case 0x7:
                throw new Error("Unimplemented RSC");
            case 0x8:
                throw new Error("Unimplemented TST");
            case 0x9:
                throw new Error("Unimplemented TEQ");
            case 0xA:
                throw new Error("Unimplemented CMP");
            case 0xB:
                throw new Error("Unimplemented CMN");
            case 0xC:
                throw new Error("Unimplemented ORR");
            case 0xD:
                throw new Error("Unimplemented MOV");
            case 0xE:
                throw new Error("Unimplemented BIC");
            case 0xF:
                throw new Error("Unimplemented MVN");
            default:
                throw new Error("This shouldn't happen");
        }
    };
}

function generateThumbShiftByImmediate(ins: number) {
    let opcode = (ins >> 11) & 3;
    return function (this: ArmCpu, ins: number) {
        switch (opcode) {
            
        }
    };
}

class ArmCpu {
    model: ArmCpuModel;
    memory: Memory;

    r: Uint32Array; // Use ArmCpu.armWriteReg(), DO NOT WRITE TO DIRECTLY
    rUsr: Uint32Array;
    rFiq: Uint32Array;
    rSvc: Uint32Array;
    rAbt: Uint32Array;
    rIrq: Uint32Array;
    rUnd: Uint32Array;

    cpsrNegative = false;
    cpsrZero = false;
    cpsrCarry = false;
    cpsrOverflow = false;
    cpsrSticky = false;
    cpsrIrqDisable = false;
    cpsrFiqDisable = false;
    cpsrThumbState = false;
    mode = ArmCpuMode.SYS;

    spsrFiq = 0;
    spsrSvc = 0;
    spsrAbt = 0;
    spsrIrq = 0;
    spsrUnd = 0;

    armExecutorTable: Array<Function>;
    thumbExecutorTable: Array<Function>;

    generateArmExecutorTable(): Array<ArmExecutor> {
        let table = new Array<ArmExecutor>(4096);

        for (let i = 0; i < 4096; i++) {
            let ins = ((i & 0xFF0) << 16) | ((i & 0xF) << 4);

            if (checkBinaryMask(ins, "101xxxxxxxxxxxxxxxxxxxxxxxxx")) {
                table[i] = armBranch.bind(this);
            } else if (checkBinaryMask(ins, "00010010xxxxxxxxxxxx0001xxxx")) {
                table[i] = armBranchWithExchange.bind(this);
            } else if (checkBinaryMask(ins, "00010x10xxxxxxxxxxxx0000xxxx")) {
                table[i] = armMsrRegister.bind(this);
            } else if (checkBinaryMask(ins, "00xxxxxxxxxxxxxxxxxxxxxxxxxx")) {
                table[i] = generateArmDataProcessing(ins).bind(this);
            } else if (checkBinaryMask(ins, "01xxxxxxxxxxxxxxxxxxxxxxxxxx")) {
                table[i] = generateArmRegularLdrStr(ins).bind(this);
            }
        }

        return table;
    }

    generateThumbExecutorTable(): Array<ArmExecutor> {
        let table = new Array<ArmExecutor>(1024);

        for (let i = 0; i < 1024; i++) {
            let ins = i << 6;
            if (checkBinaryMask(ins, "01001xxxxxxxxxxx")) {
                table[i] = thumbLdrLiteralPool.bind(this);
            } else if (checkBinaryMask(ins, "010000xxxxxxxxxx")) {
                table[i] = generateThumbDataProcessing(ins).bind(this);
            } else if (checkBinaryMask(ins, "010000xxxxxxxxxx")) {
                table[i] = generateThumbShiftByImmediate(ins).bind(this);
            }
        }

        return table;
    }

    constructor(model: ArmCpuModel, memory: Memory) {
        this.model = model;
        this.memory = memory;
        this.r = new Uint32Array(16);
        this.rUsr = new Uint32Array(7);
        this.rFiq = new Uint32Array(7);
        this.rSvc = new Uint32Array(2);
        this.rAbt = new Uint32Array(2);
        this.rIrq = new Uint32Array(2);
        this.rUnd = new Uint32Array(2);

        this.armExecutorTable = this.generateArmExecutorTable();
        this.thumbExecutorTable = this.generateThumbExecutorTable();

        this.flushPipelineInit();
    }

    getMode(): number {
        return this.mode;
    }

    setMode(mode: number) {
        // Bit 4 of mode is always set 
        mode |= 0b10000;

        // Store registers based on current mode
        switch (this.mode) {
            case ArmCpuMode.USR:
            case ArmCpuMode.SYS: for (let i = 0; i < 7; i++) this.rUsr[i] = this.r[8 + i]; break;
            case ArmCpuMode.FIQ: for (let i = 0; i < 7; i++) this.rFiq[i] = this.r[8 + i]; break;
            case ArmCpuMode.SVC: for (let i = 0; i < 2; i++) this.rSvc[i] = this.r[13 + i]; break;
            case ArmCpuMode.ABT: for (let i = 0; i < 2; i++) this.rAbt[i] = this.r[13 + i]; break;
            case ArmCpuMode.IRQ: for (let i = 0; i < 2; i++) this.rIrq[i] = this.r[13 + i]; break;
            case ArmCpuMode.UND: for (let i = 0; i < 2; i++) this.rUnd[i] = this.r[13 + i]; break;
        }

        switch (mode) {
            case ArmCpuMode.USR:
            case ArmCpuMode.SYS: for (let i = 5; i < 7; i++) this.r[8 + i] = this.rUsr[i]; break;
            case ArmCpuMode.FIQ: for (let i = 0; i < 7; i++) this.r[8 + i] = this.rFiq[i]; break;
            case ArmCpuMode.SVC: for (let i = 0; i < 2; i++) this.r[13 + i] = this.rSvc[i]; break;
            case ArmCpuMode.ABT: for (let i = 0; i < 2; i++) this.r[13 + i] = this.rAbt[i]; break;
            case ArmCpuMode.IRQ: for (let i = 0; i < 2; i++) this.r[13 + i] = this.rIrq[i]; break;
            case ArmCpuMode.UND: for (let i = 0; i < 2; i++) this.r[13 + i] = this.rUnd[i]; break;
        }

        if (this.mode == ArmCpuMode.FIQ)
            for (let i = 0; i < 5; i++) this.r[8 + i] = this.rUsr[i];

        this.mode = mode;
    }

    getCpsr(): number {
        let val = 0;

        if (this.cpsrNegative) val |= bit(31);
        if (this.cpsrZero) val |= bit(30);
        if (this.cpsrCarry) val |= bit(29);
        if (this.cpsrOverflow) val |= bit(28);
        if (this.cpsrSticky) val |= bit(27);

        if (this.cpsrIrqDisable) val |= bit(7);
        if (this.cpsrFiqDisable) val |= bit(6);
        if (this.cpsrThumbState) val |= bit(5);

        val |= this.getMode();
        return val;
    }

    setCpsr(val: number) {
        this.cpsrNegative = bitTest(val, 31);
        this.cpsrZero = bitTest(val, 30);
        this.cpsrCarry = bitTest(val, 29);
        this.cpsrOverflow = bitTest(val, 28);
        this.cpsrSticky = bitTest(val, 27);

        this.cpsrIrqDisable = bitTest(val, 7);
        this.cpsrFiqDisable = bitTest(val, 6);
        this.cpsrThumbState = bitTest(val, 5);

        this.setMode(val & 0b01111);
    }

    getSpsr(): number {
        switch (this.mode) {
            case ArmCpuMode.FIQ:
            case ArmCpuMode.OldFIQ:
                return this.spsrFiq;
            case ArmCpuMode.SVC:
            case ArmCpuMode.OldSVC:
                return this.spsrSvc;
            case ArmCpuMode.ABT:
                return this.spsrAbt;
            case ArmCpuMode.IRQ:
            case ArmCpuMode.OldIRQ:
                return this.spsrIrq;
            case ArmCpuMode.UND:
                return this.spsrUnd;

        }

        console.warn("No SPSR in this mode!");
        return this.getCpsr();
    }

    setSpsr(set: number): void {
        switch (this.mode) {
            case ArmCpuMode.FIQ:
            case ArmCpuMode.OldFIQ:
                this.spsrFiq = set;
                return;
            case ArmCpuMode.SVC:
            case ArmCpuMode.OldSVC:
                this.spsrSvc = set;
                return;
            case ArmCpuMode.ABT:
                this.spsrAbt = set;
                return;
            case ArmCpuMode.IRQ:
            case ArmCpuMode.OldIRQ:
                this.spsrIrq = set;
                return;
            case ArmCpuMode.UND:
                this.spsrUnd = set;
                return;

        }

        console.warn("No SPSR in this mode!");
        this.setCpsr(set);
    }

    armSetReg(reg: number, val: number) {
        this.r[reg] = val;
        if (reg == 15) {
            this.flushPipeline();
        }
    }

    checkCondition(code: number): boolean {
        // Unconditional execution is most common, do a quick check 
        // instead of going through a slow switch
        if (code == 0xE) {
            return true;
        }

        switch (code) {
            case 0x0: // Zero, Equal, Z=1
                return this.cpsrZero;
            case 0x1: // Nonzero, Not Equal, Z=0
                return !this.cpsrZero;
            case 0x2: // Unsigned higher or same, C=1
                return this.cpsrCarry;
            case 0x3: // Unsigned lower, C=0
                return !this.cpsrCarry;
            case 0x4: // Signed Negative, Minus, N=1
                return this.cpsrNegative;
            case 0x5: // Signed Positive or Zero, Plus, N=0
                return !this.cpsrNegative;
            case 0x6: // Signed Overflow, V=1
                return this.cpsrOverflow;
            case 0x7: // Signed No Overflow, V=0
                return !this.cpsrOverflow;
            case 0x8: // Unsigned Higher, C=1 && Z=0
                return this.cpsrCarry && !this.cpsrZero;
            case 0x9: // Unsigned Lower or Same
                return !this.cpsrCarry || this.cpsrZero;
            case 0xA: // Signed Greater or Equal
                return this.cpsrNegative == this.cpsrOverflow;
            case 0xB: // Signed Less Than
                return this.cpsrNegative != this.cpsrOverflow;
            case 0xC: // Signed Greater Than
                return !this.cpsrZero && this.cpsrNegative == this.cpsrOverflow;
            case 0xD: // Signed less or Equal, Z=1 or N!=V
                return this.cpsrZero || (this.cpsrNegative != this.cpsrOverflow);
            case 0xE: // Always
                return true;
            case 0xF: // some ARMv5 instructions have 0xF as condition code in encoding
                return true;
        }

        return false;
    }

    executeArm() {
        let ins = this.memory.read32(this.r[15] - 8);
        console.log(`${hexN(this.r[15] - 8, 8)}: ${hexN(ins, 8)}`);

        let conditionCode = (ins >> 28) & 0xF;
        if (this.checkCondition(conditionCode)) {
            let decodeBits = ((ins >> 16) & 0xFF0) | ((ins >> 4) & 0xF);
            let executor = this.armExecutorTable[decodeBits];

            if (executor != null) {
                executor(ins);
                // console.log(executor);
            } else {
                throw new Error("Null executor");
            }
        }

        if (!this.cpsrThumbState) {
            this.r[15] += 4;
        }
        else {
            this.r[15] += 2;
        }
    }

    executeThumb() {
        let ins = this.memory.read16(this.r[15] - 4);
        console.log(`${hexN(this.r[15] - 4, 8)}: ${hexN(ins, 4)}`);

        let decodeBits = ins >> 6;
        let executor = this.thumbExecutorTable[decodeBits];

        if (executor != null) {
            executor(ins);
        } else {
            throw new Error("Null executor");
        }

        if (!this.cpsrThumbState) {
            this.r[15] += 4;
        }
        else {
            this.r[15] += 2;
        }
    }

    execute(): number {
        if (this.cpsrThumbState) {
            this.executeThumb();
        } else {
            this.executeArm();
        }

        let statusString = "";
        statusString += `N:${+this.cpsrNegative} `;
        statusString += `Z:${+this.cpsrZero} `;
        statusString += `C:${+this.cpsrCarry} `;
        statusString += `V:${+this.cpsrOverflow} `;
        statusString += `S:${+this.cpsrSticky} `;
        statusString += `I:${+this.cpsrIrqDisable} `;
        statusString += `F:${+this.cpsrFiqDisable} `;
        statusString += `T:${+this.cpsrThumbState} `;

        console.log(statusString);

        return 1;
    }

    flushPipeline(): void {
        if (this.cpsrThumbState) {
            this.r[15] += 2;
        }
        else {
            this.r[15] += 4;
        }
    }

    flushPipelineInit(): void {
        if (this.cpsrThumbState) {
            this.r[15] += 4;
        }
        else {
            this.r[15] += 8;
        }
    }
}