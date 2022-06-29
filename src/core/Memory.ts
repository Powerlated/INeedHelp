interface Memory {
    read8(addr: number): number;
    write8(addr: number, val: number): void;
    read16(addr: number): number;
    write16(addr: number, val: number): void;
    read32(addr: number): number;
    write32(addr: number, val: number): void;
}