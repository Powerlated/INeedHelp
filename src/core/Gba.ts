const DISPCNT = 0x4000000;

class GbaPpu {

}

class GbaMemory implements Memory {
    rom: DataView;
    ewram: DataView;
    iwram: DataView;

    constructor(rom: Uint8Array) {
        this.rom = new DataView(rom.buffer);
        this.ewram = new DataView(new ArrayBuffer(262144));
        this.iwram = new DataView(new ArrayBuffer(32768));
    }

    readIo8(addr: number): number {
        switch (addr) {
            default:
                console.warn(`Unknown IO Read @ ${hexN(addr, 8)}`);
                return 0;
        }
    }
    writeIo8(addr: number, val: number): void {
        switch (addr) {
            default:
                console.warn(`Unknown IO Read @ ${hexN(addr, 8)}`);
                return;
        }
    }

    read8(addr: number): number {
        throw new Error("Method not implemented.");
    }
    write8(addr: number, val: number) {
        throw new Error("Method not implemented.");
    }
    read16(addr: number): number {
        switch ((addr >> 24) & 0xF) {
            case 0x8:
            case 0x9:
            case 0xA:
            case 0xB:
            case 0xC:
            case 0xD:
                return this.rom.getUint16(addr & 0x1FFFFFF, true);
        }

        throw new Error("Not implemented");
    }
    write16(addr: number, val: number) {
        throw new Error("Method not implemented.");
    }
    read32(addr: number): number {
        switch ((addr >> 24) & 0xF) {
            case 0x4:
                return this.readIo8(addr + 0) |
                    (this.readIo8(addr + 1) << 8) |
                    (this.readIo8(addr + 2) << 16) |
                    (this.readIo8(addr + 3) << 24);

            case 0x8:
            case 0x9:
            case 0xA:
            case 0xB:
            case 0xC:
            case 0xD:
                return this.rom.getUint32(addr & 0x1FFFFFF, true);
        }

        throw new Error("Not implemented");
    }
    write32(addr: number, val: number): void {
        switch ((addr >> 24) & 0xF) {
            case 0x4:
                this.writeIo8(addr + 0, (val >> 0) & 0xFF);
                this.writeIo8(addr + 1, (val >> 8) & 0xFF);
                this.writeIo8(addr + 2, (val >> 16) & 0xFF);
                this.writeIo8(addr + 3, (val >> 24) & 0xFF);
                break;

            default:
                throw new Error("Not implemented");
        }
    }
}

class Gba {
    memory: GbaMemory;
    cpu: ArmCpu;

    constructor(rom: Uint8Array) {
        this.memory = new GbaMemory(rom);
        this.cpu = new ArmCpu(ArmCpuModel.ARM7, this.memory);
        this.cpu.r[15] = 0x08000000;
        this.cpu.flushPipelineInit();
    }

    run() {

        let cycles: number = this.cpu.execute();
    }
}