const WIDTH = 240;
const HEIGHT = 160;

const DISPCNT = 0x4000000;

class GbaPpu {
    scheduler: Scheduler;
    frameDoneCallback?: Function;

    vCount = 0;
    scanlineStartCycles = 0;

    screenBuffer: ImageData;

    palettes: DataView;
    vram: DataView;

    constructor(scheduler: Scheduler, frameDoneCallback?: Function) {
        this.scheduler = scheduler;
        this.frameDoneCallback = frameDoneCallback;

        this.palettes = new DataView(new ArrayBuffer(1024));
        this.vram = new DataView(new ArrayBuffer(98304));
        this.screenBuffer = new ImageData(WIDTH, HEIGHT);

        this.scheduler.addEventRelative(SchedulerId.Ppu, 960, this.endDrawingToHBlank);
    }

    renderScanline() {
        let bufferIndex = WIDTH * 4 * this.vCount;
        let vramIndex = this.vCount * WIDTH;
        for (let i = 0; i < WIDTH; i++) {
            let paletteIndex = this.vram.getUint8(vramIndex++);
            let color = this.palettes.getUint16(paletteIndex * 2, true);
            let r = (color >> 0) & 0x1F;
            let g = (color >> 5) & 0x1F;
            let b = (color >> 10) & 0x1F;
            this.screenBuffer.data[bufferIndex++] = (r << 3) || (r >> 2);
            this.screenBuffer.data[bufferIndex++] = (g << 3) || (g >> 2);
            this.screenBuffer.data[bufferIndex++] = (b << 3) || (b >> 2);
            this.screenBuffer.data[bufferIndex++] = 0xFF;
        }
    }

    getScanlineCycles() {
        return this.scheduler.currentTicks - this.scanlineStartCycles;
    }

    endDrawingToHBlank = (cyclesLate: number) => {
        this.scheduler.addEventRelative(SchedulerId.Ppu, 272 - cyclesLate, this.endHBlank);

        this.renderScanline();
    };

    endVBlankToHBlank = (cyclesLate: number) => {
        this.scheduler.addEventRelative(SchedulerId.Ppu, 272 - cyclesLate, this.endHBlank);

        // TODO: HBlank IRQ
    };

    endHBlank = (cyclesLate: number) => {
        this.scanlineStartCycles = this.scheduler.currentTicks - cyclesLate;

        if (this.vCount != 227) {
            this.vCount++;

            if (this.vCount > 159) {
                this.scheduler.addEventRelative(SchedulerId.Ppu, 960 - cyclesLate, this.endVBlankToHBlank);

                if (this.vCount == 160) {
                    // TODO: VBlank IRQ
                }

                if (this.frameDoneCallback) {
                    this.frameDoneCallback();
                }
            } else {
                this.scheduler.addEventRelative(SchedulerId.Ppu, 960 - cyclesLate, this.endDrawingToHBlank);
            }
        } else {
            this.vCount = 0;

            this.scheduler.addEventRelative(SchedulerId.Ppu, 960 - cyclesLate, this.endDrawingToHBlank);
        }
    };

    readDispStat(n: number): number {
        let val = 0;
        switch (n) {
            case 0: // DISPSTAT B0
                // Vblank flag is set in scanlines 160-226, not including 227 for some reason
                if (this.vCount >= 160 && this.vCount <= 226) val |= bit(0); // Vblank Flag
                // Hblank flag is set at cycle 1006, not cycle 960
                if (this.getScanlineCycles() >= 1006) val |= bit(1); // Hblank Flag
                // if (this.vCounterMatch) val |= bit(2);
                // if (this.vBlankIrqEnable) val |= bit(3);
                // if (this.hBlankIrqEnable) val |= bit(4);
                // if (this.vCounterIrqEnable) val |= bit(5);
                return val;
            case 1: // DISPSTAT B1
                // val |= VCountSetting;
                return val;
        }

        throw new Error();
    }
}

class Gba {
    ppu: GbaPpu;
    cpu: ArmCpu;
    scheduler: Scheduler;

    rom: DataView;
    ewram: DataView;
    iwram: DataView;

    constructor(rom: Uint8Array, frameDoneCallback: Function) {
        this.cpu = new ArmCpu(false, this.read8, this.write8, this.read16, this.write16, this.read32, this.write32);
        this.cpu.r[15] = 0x08000000;
        this.cpu.flushPipelineInit();
        this.scheduler = new Scheduler();
        this.ppu = new GbaPpu(this.scheduler, frameDoneCallback);

        this.rom = new DataView(rom.buffer);
        this.ewram = new DataView(new ArrayBuffer(262144));
        this.iwram = new DataView(new ArrayBuffer(32768));
    }

    run() {
        let cycles: number = this.cpu.execute();

        this.scheduler.currentTicks += cycles;

        while (this.scheduler.currentTicks >= this.scheduler.nextEventTicks) {
            let current = this.scheduler.currentTicks;
            let next = this.scheduler.nextEventTicks;
            this.scheduler.popFirstEvent().callback(current - next);
        }
    }

    readIo8(addr: number): number {
        switch (addr) {
            case 0x4000004:
            case 0x4000005:
                return this.ppu.readDispStat(addr & 1);

            case 0x4000130:
            case 0x4000131:
                return 0xFF;

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

    read8 = (addr: number): number => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                return this.ewram.getUint8(addr & 0x3FFFF);
            case 0x3:
                return this.iwram.getUint8(addr & 0x7FFF);
            case 0x8:
            case 0x9:
            case 0xA:
            case 0xB:
            case 0xC:
            case 0xD:
                return this.rom.getUint8(addr & 0x1FFFFFF);
        }

        throw new Error("Not implemented: " + hexN(addr, 8));
    };
    write8 = (addr: number, val: number) => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                this.ewram.setUint8(addr & 0x3FFFF, val);
                return;
            case 0x3:
                this.iwram.setUint8(addr & 0x7FFF, val);
                return;
        }

        throw new Error("Not implemented: " + hexN(addr, 8));
    };
    read16 = (addr: number): number => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                return this.ewram.getUint16(addr & 0x3FFFF, true);
            case 0x3:
                return this.iwram.getUint16(addr & 0x7FFF, true);
            case 0x4:
                return this.readIo8(addr + 0) |
                    (this.readIo8(addr + 1) << 8);
            case 0x8:
            case 0x9:
            case 0xA:
            case 0xB:
            case 0xC:
            case 0xD:
                return this.rom.getUint16(addr & 0x1FFFFFF, true);
        }

        throw new Error("Not implemented addr:" + hexN(addr, 8));
    };
    write16 = (addr: number, val: number): void => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                this.ewram.setUint16(addr & 0x3FFFF, val, true);
                return;
            case 0x3:
                this.iwram.setUint16(addr & 0x7FFF, val, true);
                return;
            case 0x5:
                this.ppu.palettes.setUint16(addr & 0x3FF, val, true);
                return;
            case 0x6:
                this.ppu.vram.setUint16(addr & 0x1FFFF, val, true); // TODO: VRAM mirroring
                return;
        }

        throw new Error("Not implemented addr:" + hexN(addr, 8));
    };
    read32 = (addr: number): number => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                return this.ewram.getUint32(addr & 0x3FFFF, true);
            case 0x3:
                return this.iwram.getUint32(addr & 0x7FFF, true);
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

        throw new Error("Not implemented: " + hexN(addr, 8));
    };
    write32 = (addr: number, val: number): void => {
        switch ((addr >> 24) & 0xF) {
            case 0x2:
                this.ewram.setUint32(addr & 0x3FFFF, val, true);
                break;
            case 0x3:
                this.iwram.setUint32(addr & 0x7FFF, val, true);
                break;
            case 0x4:
                this.writeIo8(addr + 0, (val >> 0) & 0xFF);
                this.writeIo8(addr + 1, (val >> 8) & 0xFF);
                this.writeIo8(addr + 2, (val >> 16) & 0xFF);
                this.writeIo8(addr + 3, (val >> 24) & 0xFF);
                break;

            case 0x6:
                this.ppu.vram.setUint32(addr & 0x1FFFF, val, true); // TODO: VRAM mirroring
                return;

            default:
                throw new Error("Not implemented addr:" + hexN(addr, 8));
        }
    };
}