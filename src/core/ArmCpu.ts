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
                {
                    let final = rnVal & shifterOperand;
                    this.armSetReg(rd, final);
                    if (setFlags) {
                        this.cpsrNegative = bitTest(final, 31);
                        this.cpsrZero = final == 0;
                        this.cpsrCarry = shifterCarryOut;

                        if (rd == 15) {
                            this.setCpsr(this.getSpsr());
                        }
                    }
                    break;
                }
            case 0x1:
                throw new Error("Unimplemented EOR");
            case 0x2:
                throw new Error("Unimplemented SUB");
            case 0x3:
                throw new Error("Unimplemented RSB");
            case 0x4:
                {
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
                }
            case 0x5:
                throw new Error("Unimplemented ADC");
            case 0x6:
                {
                    let final = rnVal - shifterOperand - (this.cpsrCarry ? 0 : 1);

                    this.armSetReg(rd, final);
                    if (setFlags) {
                        this.cpsrNegative = bitTest(final, 31); // N
                        this.cpsrZero = final == 0; // Z
                        this.cpsrCarry = shifterOperand + (this.cpsrCarry ? 0 : 1) <= rnVal; // C
                        this.cpsrOverflow = checkOverflowSub(rnVal, shifterOperand, final); // V

                        if (rd == 15) {
                            this.setCpsr(this.getSpsr());
                        }
                    }
                }
                break;
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
                {
                    if (setFlags) {
                        this.cpsrNegative = bitTest(shifterOperand, 31);
                        this.cpsrZero = shifterOperand == 0;
                        this.cpsrCarry = shifterCarryOut;
                    }

                    this.armSetReg(rd, shifterOperand);
                    break;
                }
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

function generateArmMiscellaneousLdrStr(ins: number) {
    let h = bitTest(ins, 5);
    let s = bitTest(ins, 6);
    let l = bitTest(ins, 20);
    let w = bitTest(ins, 21); // Writeback to base register
    let immediateOffset = bitTest(ins, 22);
    let u = bitTest(ins, 23); // Add / Subtract offset
    let p = bitTest(ins, 24); // Use post-indexed / offset or pre-indexed 

    return function (this: ArmCpu, ins: number) {
        let rd = (ins >> 12) & 0xF;
        let rn = (ins >> 16) & 0xF;

        let baseAddr = this.r[rn];

        let offset;
        if (immediateOffset) {
            let immed = (ins & 0xF) | ((ins >> 4) & 0xF0);
            offset = immed;
        }
        else {
            let rm = ins & 0xF;
            offset = this.r[rm];
        }

        let addr = baseAddr;
        if (p) {
            if (u) {
                addr += offset;
            }
            else {
                addr -= offset;
            }
        }

        let loadVal = 0;
        if (l) {
            if (s) {
                if (h) {
                    let readVal;
                    if ((addr & 1) != 0) {
                        // Misaligned, read byte instead.
                        // Sign extend
                        readVal = this.memory.read8(addr) << 24 >> 24;
                    }
                    else {
                        // Sign extend
                        readVal = this.memory.read16(addr) << 16 >> 16;
                    }
                    loadVal = readVal;
                }
                else {
                    let val = this.memory.read8(addr) << 24 >> 24;

                    loadVal = val;
                }
            }
            else {
                if (h) {
                    // Force halfword aligned, and rotate if unaligned
                    loadVal = rotateRight32(this.memory.read16(addr & ~1), (addr & 1) * 8);
                }
            }
        }
        else {
            if (s) {
                if (this.isArmV5) {
                    if (h) {
                        // Store Double Word
                        throw new Error(`UNIMPLEMENTED R15:${hex(this.r[15], 8)} OPCODE:${hex(ins, 8)} STRD`);
                    }
                    else {
                        // Load Double Word
                        throw new Error(`UNIMPLEMENTED R15:${hex(this.r[15], 8)} OPCODE:${hex(ins, 8)} LDRD`);
                    }
                }
                else {
                    throw new Error(`This shouldn't happen`);
                }
            }
            else {
                if (h) {
                    // Store Half Word
                    this.memory.write16(addr & ~1, this.r[rd] & 0xFFFF);
                }
            }
        }

        if (!p) {
            if (u) {
                addr = baseAddr + offset;
            }
            else {
                addr = baseAddr - offset;
            }
        }

        if (w || !p) {
            this.r[rn] = addr;
        }

        if (l) {
            this.r[rd] = loadVal;
            this.iCycle();
        }
    };
}

function generateArmLdmStm(ins: number) {
    let P = bitTest(ins, 24); // post-indexed / offset addressing 
    let U = bitTest(ins, 23); // invert
    let S = bitTest(ins, 22);
    let W = bitTest(ins, 21);
    let L = bitTest(ins, 20); // Load vs Store
    return function (this: ArmCpu, ins: number) {
        let loadsPc = bitTest(ins, 15);

        let oldMode = 0;
        if (S && (!L || !loadsPc)) {
            oldMode = this.getMode();
            this.setMode(ArmCpuMode.USR);
        }

        let rn = (ins >> 16) & 0xF;

        let addr = this.r[rn];

        // String regs = "";

        let bitsSet = popCount(ins & 0xFFFF);
        let writebackValue;
        if (U) {
            if (W) {
                writebackValue = addr + bitsSet * 4;
            }
            else {
                writebackValue = addr;
            }
        }
        else {
            if (W) {
                writebackValue = addr - bitsSet * 4;
            }
            else {
                writebackValue = addr;
            }
            if (P) {
                addr = addr - bitsSet * 4 - 4;
            }
            else {
                addr = addr - bitsSet * 4 + 4;
            }
        }

        if (!L) {
            this.r[15] += 4;
        }

        for (let r = 0; r < 16; r++) {
            if (bitTest(ins, r)) {
                if (L) {
                    if (W) {
                        this.r[rn] = writebackValue;
                    }

                    if (P) addr += 4;

                    if (r != 15) {
                        this.r[r] = this.memory.read32(addr & ~3);
                    }
                    else {
                        this.r[15] = this.memory.read32(addr & ~3);
                        this.cpsrThumbState = bitTest(this.r[15], 0);
                        this.flushPipeline();
                    }

                    if (!P) addr += 4;
                }
                else {

                    if (P) addr += 4;

                    this.memory.write32(addr & ~3, this.r[r]);

                    if (!P) addr += 4;
                }
            }
        }

        if (!L) {
            this.r[15] -= 4;
        }

        // ARMv5: When Rn is in Rlist, writeback happens if Rn is the only register, or not the last
        // I can't figure out the order of operations so I'll just hack the only register case 
        if (!L || bitsSet == 1) {
            this.r[rn] = writebackValue;
        }

        let emptyRlist = (ins & 0xFFFF) == 0;
        if (emptyRlist) {
            if (U) {
                this.r[rn] += 0x40;
            }
            else {
                this.r[rn] -= 0x40;
            }
        }

        if (S) {
            if (L && loadsPc) {
                this.setCpsr(this.getSpsr());
            }
            else {
                this.setMode(oldMode);
            }
        }

        this.iCycle();
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
        // Rm/Rs and Rd/Rn are the same, just different names for this encoding
        let rd = (ins >> 0) & 0b111;
        let rn = rd;
        let rm = (ins >> 3) & 0b111;
        let rs = rm;

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
                {
                    let rnVal = this.r[(ins >> 0) & 0b111];
                    let rmVal = this.r[(ins >> 3) & 0b111];

                    let final = (rnVal - rmVal) & 0xFFFFFFFF;

                    this.cpsrNegative = bitTest(final, 31);
                    this.cpsrZero = final == 0;
                    this.cpsrCarry = !(rmVal > rnVal);
                    this.cpsrOverflow = checkOverflowSub(rnVal, rmVal, final);
                    break;
                }
            case 0xB:
                throw new Error("Unimplemented CMN");
            case 0xC:
                throw new Error("Unimplemented ORR");
            case 0xD:
                throw new Error("Unimplemented MOV");
            case 0xE: // BIC
                {
                    let rdVal = this.r[rd];
                    let rmVal = this.r[rm];

                    let final = rdVal & ~rmVal;
                    this.r[rd] = final;

                    this.cpsrNegative = bitTest(final, 31);
                    this.cpsrZero = final == 0;
                    break;
                }
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
        let immed5 = (ins >> 6) & 0b11111;
        let rd = (ins >> 0) & 0b111;
        let rmVal = this.r[(ins >> 3) & 0b111];

        switch (opcode) {
            case 0b00: // LSL (1)
                if (immed5 == 0) {
                    this.r[rd] = rmVal;
                }
                else {
                    this.cpsrCarry = bitTest(rmVal, 32 - immed5);
                    this.r[rd] = logicalShiftLeft32(rmVal, immed5);
                }

                this.cpsrNegative = bitTest(this.r[rd], 31);
                this.cpsrZero = this.r[rd] == 0;
                break;
            case 0b01: // LSR (1)
                if (immed5 == 0) {
                    this.cpsrCarry = bitTest(rmVal, 31);
                    this.r[rd] = 0;
                }
                else {
                    this.cpsrCarry = bitTest(rmVal, immed5 - 1);
                    this.r[rd] = logicalShiftRight32(rmVal, immed5);
                }

                this.cpsrNegative = bitTest(this.r[rd], 31);
                this.cpsrZero = this.r[rd] == 0;
                break;
            case 0b10: // ASR (1)
                if (immed5 == 0) {
                    this.cpsrCarry = bitTest(rmVal, 31);
                    this.r[rd] = rmVal >> 31;
                }
                else {
                    this.cpsrCarry = bitTest(rmVal, immed5 - 1);
                    this.r[rd] = arithmeticShiftRight32(rmVal, immed5);
                }

                this.cpsrNegative = bitTest(this.r[rd], 31);
                this.cpsrZero = this.r[rd] == 0;
                break;
            case 0b11: // Add/subtract/compare/move immediate
                {
                    let rnVal = this.r[(ins >> 3) & 0b111];
                    let rmVal = this.r[(ins >> 6) & 0b111];
                    switch ((ins >> 9) & 0b11) {
                        case 0b00: // ADD (3)
                            {
                                let final = rnVal + rmVal;
                                this.r[rd] = final;

                                this.cpsrNegative = bitTest(final, 31);
                                this.cpsrZero = final == 0;
                                this.cpsrCarry = rnVal + rmVal > 0xFFFFFFFF;
                                this.cpsrOverflow = checkOverflowAdd(rnVal, rmVal, final);
                                break;
                            }
                        case 0b01: // SUB (3)
                            {
                                let final = rnVal - rmVal;
                                this.r[rd] = final;

                                this.cpsrNegative = bitTest(final, 31);
                                this.cpsrZero = final == 0;
                                this.cpsrCarry = !(rmVal > rnVal);
                                this.cpsrOverflow = checkOverflowSub(rnVal, rmVal, final);
                                break;
                            }
                        case 0b10: // ADD (1) // MOV (2)
                            {
                                let immed3 = (ins >> 6) & 0b111;
                                let final = rnVal + immed3;
                                this.r[rd] = final;

                                this.cpsrNegative = bitTest(final, 31);
                                this.cpsrZero = final == 0;
                                this.cpsrCarry = rnVal + immed3 > 0xFFFFFFFF;
                                this.cpsrOverflow = checkOverflowAdd(rnVal, immed3, final);
                                break;
                            }
                        case 0b11: // SUB (1)
                            {
                                let immed3 = (ins >> 6) & 0b111;
                                let final = rnVal - immed3;
                                this.r[rd] = final;

                                this.cpsrNegative = bitTest(final, 31);
                                this.cpsrZero = final == 0;
                                this.cpsrCarry = !(immed3 > rnVal);
                                this.cpsrOverflow = checkOverflowSub(rnVal, immed3, final);
                                break;
                            }
                    }
                }
                break;
        }
    };
}

function thumbConditionalBranch(this: ArmCpu, ins: number) {
    let cond = (ins >> 8) & 0xF;
    let condition = this.checkCondition(cond);

    if (condition) {
        // B
        let offset = (ins & 0xFF) << 1;
        // Signed with Two's Complement
        offset = (offset << 23) >> 23;

        this.r[15] = this.r[15] + offset;
        this.flushPipeline();
    }
}

function generateThumbAddSubCmpMovImmediate(ins: number) {
    let opcode = (ins >> 11) & 0b11;
    return function (this: ArmCpu, ins: number) {
        let rd = (ins >> 8) & 0b111;
        let rn = (ins >> 8) & 0b111;
        let immed8 = ins & 0xFF;

        switch (opcode) {
            case 0b00: // MOV (1)
                {
                    this.r[rd] = immed8;

                    this.cpsrNegative = false;
                    this.cpsrZero = immed8 == 0;
                    break;
                }
            case 0b01: // CMP (1)
                {
                    let rnVal = this.r[rn];
                    let final = rnVal - immed8;

                    this.cpsrNegative = bitTest(final, 31);
                    this.cpsrZero = final == 0;
                    this.cpsrCarry = !(immed8 > rnVal);
                    this.cpsrOverflow = checkOverflowSub(rnVal, immed8, final);
                    break;
                }
            case 0b10: // ADD (2)
                {
                    let rdVal = this.r[rd];
                    let final = rdVal + immed8;

                    this.r[rd] = final;
                    this.cpsrNegative = bitTest(final, 31);
                    this.cpsrZero = final == 0;
                    this.cpsrCarry = rdVal + immed8 > 0xFFFFFFFF;
                    this.cpsrOverflow = checkOverflowAdd(rdVal, immed8, final);
                    break;
                }
            case 0b11: // SUB (2)
                {
                    let rdVal = this.r[rd];

                    let final = rdVal - immed8;
                    this.r[rd] = final;

                    this.cpsrNegative = bitTest(final, 31);
                    this.cpsrZero = final == 0;
                    this.cpsrCarry = !(immed8 > rdVal);
                    this.cpsrOverflow = checkOverflowSub(rdVal, immed8, final);
                    break;
                }
        }
    };
}

function thumbUnconditionalBranch(this: ArmCpu, ins: number) {
    let signedImmed11 = (ins & 0b11111111111) << 1;
    signedImmed11 = (signedImmed11 << 20) >> 20;

    this.r[15] = this.r[15] + signedImmed11;
    this.flushPipeline();
}

function thumbBlBlxPrefix(this: ArmCpu, ins: number) {
    let offset11 = ins & 0b11111111111;

    offset11 <<= 12;

    // Sign extend
    offset11 = offset11 << 9 >> 9;

    this.r[14] = this.r[15] + offset11;
}

function thumbBlSuffix(this: ArmCpu, ins: number) {
    let offset11 = ins & 0b11111111111;

    let oldR14 = this.r[14];
    this.r[14] = (this.r[15] - 2) | 1;
    this.r[15] = oldR14 + (offset11 << 1);
    this.r[15] &= ~1;
    this.flushPipeline();
}


function thumbBlxSuffix(this: ArmCpu, ins: number) {
    let offset11 = ins & 0b11111111111;

    let oldR14 = this.r[14];
    this.r[14] = (this.r[15] - 2) | 1;
    this.r[15] = (oldR14 + (offset11 << 1)) & ~3;
    this.cpsrThumbState = false;
    this.flushPipeline();
}


function generateThumbLdmiaStmia(ins: number) {
    let l = bitTest(ins, 11);
    return function (this: ArmCpu, ins: number) {
        if (l) {
            let rn = (ins >> 8) & 0b111;
            let addr = this.r[rn];

            let registerList = ins & 0xFF;
            let registerCount = popCount(registerList);
            let writebackVal = this.r[rn] + (registerCount << 2);

            this.r[rn] = writebackVal;

            let register = 0;
            for (; registerList != 0; registerList >>= 1) {
                if (bitTest(registerList, 0)) {
                    this.r[register] = this.memory.read32(addr & ~3);
                    addr += 4;
                }
                register++;
            }

            // Handle empty rlist
            if ((ins & 0xFF) == 0) {
                if (!this.isArmV5) {
                    this.r[15] = this.memory.read32(addr & ~3);
                    this.flushPipeline();
                }
                this.r[rn] += 0x40;
            }

            this.iCycle();
        } else {
            let rn = (ins >> 8) & 0b111;
            let addr = this.r[rn];

            this.r[15] += 2;

            let registerList = ins & 0xFF;
            let writebackVal = this.r[rn] + popCount(registerList) * 4;

            let register = 0;
            for (; registerList != 0; registerList >>= 1) {
                if (bitTest(registerList, 0)) {
                    this.memory.write32(addr & ~3, this.r[register]);
                    addr += 4;
                    if (!this.isArmV5) {
                        this.r[rn] = writebackVal;
                    }
                }
                register++;
            }


            // Handle empty rlist
            if ((ins & 0xFF) == 0) {
                if (!this.isArmV5) {
                    this.memory.write32(addr & ~3, this.r[15]);
                }
                this.r[rn] += 0x40;
            }
            this.r[15] -= 2;
        }
    };
}

function thumbSpecialDataMov(this: ArmCpu, ins: number) {
    let rd = ((ins >> 0) & 0b111) | ((ins & bit(7)) >> 4);
    let rm = ((ins >> 3) & 0b111) | ((ins & bit(6)) >> 3);

    this.r[rd] = this.r[rm];

    if (rd == 15) {
        this.r[15] &= ~1;
        this.flushPipeline();
    }
}

function thumbSpecialDataBx(this: ArmCpu, ins: number) {
    let rm = (ins >> 3) & 0xF; // High bit is technically an H bit, but can be ignored here
    let val = this.r[rm];

    // BLX (2)
    if (bitTest(ins, 7)) {
        this.r[14] = (this.r[15] - 2) | 1;
    }

    this.cpsrThumbState = bitTest(val, 0);
    this.r[15] = val & ~1;
    this.flushPipeline();
}

function thumbRegOffsStr(this: ArmCpu, ins: number) {
    let rd = (ins >> 0) & 0b111;
    let rn = (ins >> 3) & 0b111;
    let rm = (ins >> 6) & 0b111;

    let rnVal = this.r[rn];
    let rmVal = this.r[rm];

    let addr = rnVal + rmVal;
    this.memory.write32(addr & ~0b11, this.r[rd]);
}


function thumbImmOffsStr(this: ArmCpu, ins: number) {
    let rd = (ins >> 0) & 0b111;
    let rnValue = this.r[(ins >> 3) & 0b111];
    let immed5 = (ins >> 6) & 0b11111;

    let addr = rnValue + (immed5 << 2);

    this.memory.write32(addr & ~3, this.r[rd]);
}

function thumbPush(this: ArmCpu, ins: number) {
    let addr = this.r[13];

    addr -= popCount(ins & 0x1FF) * 4;
    addr &= 0xFFFFFFFF;

    if (bitTest(ins, 0)) { /* regs += "R0 "; */ this.memory.write32(addr & ~3, this.r[0]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 1)) { /* regs += "R1 "; */ this.memory.write32(addr & ~3, this.r[1]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 2)) { /* regs += "R2 "; */ this.memory.write32(addr & ~3, this.r[2]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 3)) { /* regs += "R3 "; */ this.memory.write32(addr & ~3, this.r[3]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 4)) { /* regs += "R4 "; */ this.memory.write32(addr & ~3, this.r[4]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 5)) { /* regs += "R5 "; */ this.memory.write32(addr & ~3, this.r[5]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 6)) { /* regs += "R6 "; */ this.memory.write32(addr & ~3, this.r[6]); addr += 4; this.r[13] -= 4; }
    if (bitTest(ins, 7)) { /* regs += "R7 "; */ this.memory.write32(addr & ~3, this.r[7]); addr += 4; this.r[13] -= 4; }

    if (bitTest(ins, 8)) {
        /* regs += "LR "; */
        this.memory.write32(addr, this.r[14]);
        addr += 4;
        this.r[13] -= 4;
    }

    // Handle empty rlist
    if ((ins & 0x1FF) == 0) {
        if (!this.isArmV5) {
            this.memory.write32(addr & ~3, this.r[15]);
        }
        this.r[13] += 0x40;
    }

    // LineDebug(regs);
}

function thumbPop(this: ArmCpu, ins: number) {
    // String regs = "";
    let addr = this.r[13];

    let registerCount = popCount(ins & 0x1FF);
    this.r[13] = addr + registerCount * 4;

    if (bitTest(ins, 0)) { /* regs += "R0 "; */ this.r[0] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 1)) { /* regs += "R1 "; */ this.r[1] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 2)) { /* regs += "R2 "; */ this.r[2] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 3)) { /* regs += "R3 "; */ this.r[3] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 4)) { /* regs += "R4 "; */ this.r[4] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 5)) { /* regs += "R5 "; */ this.r[5] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 6)) { /* regs += "R6 "; */ this.r[6] = this.memory.read32(addr & ~3); addr += 4; }
    if (bitTest(ins, 7)) { /* regs += "R7 "; */ this.r[7] = this.memory.read32(addr & ~3); addr += 4; }

    if (bitTest(ins, 8)) {
        /* regs += "PC "; */
        this.r[15] = this.memory.read32(addr);
        if (this.isArmV5) {
            this.cpsrThumbState = bitTest(this.r[15], 0);
        }
        this.flushPipeline();
        addr += 4;
    }


    // Handle empty rlist
    if ((ins & 0x1FF) == 0) {
        if (!this.isArmV5) {
            this.r[15] = this.memory.read32(addr & ~3);
            this.flushPipeline();
        }
        this.r[13] += 0x40;
    }

    // LineDebug(regs);

    this.iCycle();
}

function resolveArmExecutor(ins: number) {
    if (checkBinaryMask(ins, "101xxxxxxxxxxxxxxxxxxxxxxxxx")) {
        return armBranch;
    } else if (checkBinaryMask(ins, "00010010xxxxxxxxxxxx0001xxxx")) {
        return armBranchWithExchange;
    } else if (checkBinaryMask(ins, "00010x10xxxxxxxxxxxx0000xxxx")) {
        return armMsrRegister;
    } else if (
        checkBinaryMask(ins, "000xxxxxxxxxxxxxxxxxxxx0xxxx") ||
        checkBinaryMask(ins, "000xxxxxxxxxxxxxxxxx0xx1xxxx") ||
        checkBinaryMask(ins, "001xxxxxxxxxxxxxxxxxxxxxxxxx")
    ) {
        return generateArmDataProcessing(ins);
    } else if (checkBinaryMask(ins, "01xxxxxxxxxxxxxxxxxxxxxxxxxx")) {
        return generateArmRegularLdrStr(ins);
    } else if (checkBinaryMask(ins, "000xxxxxxxxxxxxxxxxx1xx1xxxx")) {
        return generateArmMiscellaneousLdrStr(ins);
    } else if (checkBinaryMask(ins, "100xxxxxxxxxxxxxxxxxxxxxxxxx")) {
        return generateArmLdmStm(ins);
    }

    return null;
}

function resolveThumbExecutor(ins: number) {
    if (checkBinaryMask(ins, "01001xxxxxxxxxxx")) {
        return thumbLdrLiteralPool;
    } else if (checkBinaryMask(ins, "010000xxxxxxxxxx")) {
        return generateThumbDataProcessing(ins);
    } else if (checkBinaryMask(ins, "000xxxxxxxxxxxxx")) {
        return generateThumbShiftByImmediate(ins);
    } else if (checkBinaryMask(ins, "1101xxxxxxxxxxxx")) {
        return thumbConditionalBranch;
    } else if (checkBinaryMask(ins, "001xxxxxxxxxxxxx")) {
        return generateThumbAddSubCmpMovImmediate(ins);
    } else if (checkBinaryMask(ins, "111xxxxxxxxxxxxx")) {
        switch ((ins >> 11) & 0b11) {
            case 0:
                return thumbUnconditionalBranch;
                break;
            case 1:
                return thumbBlxSuffix;
                break;
            case 2:
                return thumbBlBlxPrefix;
                break;
            case 3:
                return thumbBlSuffix;
                break;
        }
    } else if (checkBinaryMask(ins, "1100xxxxxxxxxxxx")) {
        return generateThumbLdmiaStmia(ins);
    } else if (checkBinaryMask(ins, "010001xxxxxxxxxx")) {
        switch ((ins >> 8) & 0b11) {
            case 0b00: // ADD (4)
                // return thumbSpecialDataAdd;
                break;
            case 0b01: // CMP (3)
                // return thumbSpecialDataCmp;
                break;
            case 0b10:// MOV (3)
                return thumbSpecialDataMov;
                break;
            case 0b11: // BX
                return thumbSpecialDataBx;
                break;
        }
    } else if (checkBinaryMask(ins, "0101xxxxxxxxxxxx")) {
        switch ((ins >> 9) & 0b111) {
            case 0b000: // STR (2)
                return thumbRegOffsStr;
                break;
            case 0b001: // STRH (2)
                // return thumbRegOffsStrh;
                break;
            case 0b010: // STRB (2)
                // return thumbRegOffsStrb;
                break;
            case 0b011: // LDRSB
                // return thumbRegOffsLdrsb;
                break;
            case 0b100: // LDR (2)
                // return thumbRegOffsLdr;
                break;
            case 0b101: // LDRH (2)
                // return thumbRegOffsLdrh;
                break;
            case 0b110: // LDRB (2)
                // return thumbRegOffsLdrb;
                break;
            case 0b111: // LDRSH
                // return thumbRegOffsLdrsh;
                break;
        }
    } else if (checkBinaryMask(ins, "011xxxxxxxxxxxxx")) {
        switch ((ins >> 11) & 0b11) {
            case 0b01: // LDR (1)
                // return thumbImmOffsLdr;
                break;
            case 0b00: // STR (1)
                return thumbImmOffsStr;
            case 0b10: // STRB (1)
                // return thumbImmOffsStrb;
                break;
            case 0b11: // LDRB (1)
                // return thumbImmOffsLdrb;
                break;
        }
    } else if (checkBinaryMask(ins, "1011x10xxxxxxxxx")) {
        if (bitTest(ins, 11)) {
            return thumbPop;
        } else {
            return thumbPush;
        }
    }
}

class ArmCpu {
    isArmV5: boolean;
    memory: Memory;

    executedNum = 0;

    preExecutionHook: null | Function = null;

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

    lastIns = 0;
    lastInsAddr = 0;
    lastInsThumbState = false;
    lastInsExecutor: any = null;

    armExecutorTable: Array<Function>;
    thumbExecutorTable: Array<Function>;

    generateArmExecutorTable(): Array<ArmExecutor> {
        let table = new Array<ArmExecutor>(4096);

        for (let i = 0; i < 4096; i++) {
            let ins = ((i & 0xFF0) << 16) | ((i & 0xF) << 4);

            table[i] = resolveArmExecutor(ins)?.bind(this);
        }

        return table;
    }

    generateThumbExecutorTable(): Array<ArmExecutor> {
        let table = new Array<ArmExecutor>(1024);

        for (let i = 0; i < 1024; i++) {
            let ins = i << 6;

            table[i] = resolveThumbExecutor(ins)?.bind(this);
        }

        return table;
    }

    constructor(isArmV5: boolean, memory: Memory) {
        this.isArmV5 = isArmV5;
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
        this.lastIns = ins;
        this.lastInsAddr = this.r[15] - 8;
        this.lastInsThumbState = false;

        let conditionCode = (ins >> 28) & 0xF;
        if (this.checkCondition(conditionCode)) {
            let decodeBits = ((ins >> 16) & 0xFF0) | ((ins >> 4) & 0xF);
            let executor = this.armExecutorTable[decodeBits];
            this.lastInsExecutor = executor;

            if (this.preExecutionHook) {
                this.preExecutionHook(ins);
            }

            if (executor != null) {
                executor(ins);
                // console.log(executor);
            } else {
                throw new Error("Null executor: " + hexN(ins, 8));
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
        this.lastIns = ins;
        this.lastInsAddr = this.r[15] - 4;
        this.lastInsThumbState = true;

        let decodeBits = ins >> 6;
        let executor = this.thumbExecutorTable[decodeBits];
        this.lastInsExecutor = executor;

        if (this.preExecutionHook) {
            this.preExecutionHook(ins);
        }

        if (executor != null) {
            executor(ins);
        } else {
            throw new Error("Null executor: " + hexN(ins, 4));
        }

        if (!this.cpsrThumbState) {
            this.r[15] += 4;
        }
        else {
            this.r[15] += 2;
        }
    }

    execute(): number {
        this.executedNum++;
        if (this.cpsrThumbState) {
            this.executeThumb();
        } else {
            this.executeArm();
        }

        return 1;
    }

    getStatusString(): string {
        let statusString = "";
        statusString += `N:${+this.cpsrNegative} `;
        statusString += `Z:${+this.cpsrZero} `;
        statusString += `C:${+this.cpsrCarry} `;
        statusString += `V:${+this.cpsrOverflow} `;
        statusString += `S:${+this.cpsrSticky} `;
        statusString += `I:${+this.cpsrIrqDisable} `;
        statusString += `F:${+this.cpsrFiqDisable} `;
        statusString += `T:${+this.cpsrThumbState}`;

        return statusString;
    }

    flushPipeline(): void {
        if (this.cpsrThumbState) {
            this.r[15] &= ~1;
            this.r[15] += 2;
        }
        else {
            this.r[15] &= ~3;
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

    iCycle() {

    }
}