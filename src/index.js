let gba = null;

/** @type {HTMLInputElement} */
let defaultRomInput = document.getElementById('default-rom-input');
defaultRomInput.value = localStorage.getItem('defaultRom') ?? '';
defaultRomInput.oninput = e => {
    localStorage.setItem('defaultRom', e.target.value);
};

/** @type {HTMLInputElement} */
let loadDefaultRomButton = document.getElementById('load-default-rom-button');
loadDefaultRomButton.onclick = () => {
    loadDefaultRom();
};

/**
 * @param {string} url  
 * @returns {Promise<Uint8Array>} */
async function loadFileFromUrl(url) {
    return new Promise((resolve, reject) => {
        let client = new XMLHttpRequest();
        client.responseType = "arraybuffer";
        client.open("GET", url);
        client.onreadystatechange = () => {
            if (client.status != 404) {
                if (client.response instanceof ArrayBuffer) {
                    resolve(new Uint8Array(client.response));
                }
            }
        };
        client.send();
    });
}

async function loadDefaultRom() {
    let file = await loadFileFromUrl(defaultRomInput.value);
    gba = new Gba(file);
    console.log(file);
}

if (defaultRomInput.value != '') {
    loadDefaultRom();
}

window.onkeydown = e => {
    if (gba) {
        switch (e.key.toLowerCase()) {
            case "f7":
                gba.run();
                break;

            case "0": console.log(`R0: ${hexN(gba.cpu.r[0], 8)}`); break;
            case "1": console.log(`R1: ${hexN(gba.cpu.r[1], 8)}`); break;
            case "2": console.log(`R2: ${hexN(gba.cpu.r[2], 8)}`); break;
            case "3": console.log(`R3: ${hexN(gba.cpu.r[3], 8)}`); break;
            case "4": console.log(`R4: ${hexN(gba.cpu.r[4], 8)}`); break;
            case "5": console.log(`R5: ${hexN(gba.cpu.r[5], 8)}`); break;
            case "6": console.log(`R6: ${hexN(gba.cpu.r[6], 8)}`); break;
            case "7": console.log(`R7: ${hexN(gba.cpu.r[7], 8)}`); break;
            case "8": console.log(`R8: ${hexN(gba.cpu.r[8], 8)}`); break;
            case "9": console.log(`R9: ${hexN(gba.cpu.r[9], 8)}`); break;
            case "a": console.log(`R10: ${hexN(gba.cpu.r[10], 8)}`); break;
            case "b": console.log(`R11: ${hexN(gba.cpu.r[11], 8)}`); break;
            case "c": console.log(`R12: ${hexN(gba.cpu.r[12], 8)}`); break;
            case "d": console.log(`R13: ${hexN(gba.cpu.r[13], 8)}`); break;
            case "e": console.log(`R14: ${hexN(gba.cpu.r[14], 8)}`); break;
            case "f": console.log(`R15: ${hexN(gba.cpu.r[15], 8)}`); break;

        }
    }
};