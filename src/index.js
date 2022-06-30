let gba = null;
let log = "";
let paused = true;

/** @type {HTMLInputElement} */
let defaultRomInput = document.getElementById('default-rom-input');
defaultRomInput.value = localStorage.getItem('defaultRom') ?? '';
defaultRomInput.oninput = e => {
    localStorage.setItem('defaultRom', e.target.value);
};

/** @type {HTMLInputElement} */
let snagPointInput = document.getElementById('snag-point-input');
snagPointInput.value = localStorage.getItem('snagPoint') ?? '';
snagPointInput.oninput = e => {
    localStorage.setItem('snagPoint', e.target.value);
};

/** @type {HTMLInputElement} */
let loadDefaultRomButton = document.getElementById('load-default-rom-button');
loadDefaultRomButton.onclick = () => {
    loadDefaultRom();
};

/** @type {HTMLCanvasElement} */
let outputCanvas = document.querySelector('#output-canvas');
let ctx2d = outputCanvas.getContext('2d');

function downloadText(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);

    element.style.display = 'none';
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}

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

function frameDoneCallback() {
    ctx2d.putImageData(gba.ppu.screenBuffer, 0, 0);
}

async function loadDefaultRom() {
    let file = await loadFileFromUrl(defaultRomInput.value);
    gba = new Gba(file, frameDoneCallback);
    console.log(file);
}

if (defaultRomInput.value != '') {
    loadDefaultRom();
}

function getDebugString() {
    let regs = "";
    for (let i = 0; i < 15; i++) {
        regs += `${hexN(gba.cpu.r[i], 8)} `;
    }

    if (gba.cpu.lastInsThumbState) {
        return `${regs}${hexN(gba.cpu.lastInsAddr, 8)} cpsr: ${hexN(gba.cpu.getCpsr(), 8)} | `;
    } else {
        return `${regs}${hexN(gba.cpu.lastInsAddr, 8)} cpsr: ${hexN(gba.cpu.getCpsr(), 8)} | `;
    }
}

window.onkeydown = e => {
    if (gba) {
        switch (e.key.toLowerCase()) {
            case "f7":
                gba.run();
                console.log(getDebugString());

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

            case "p":
                if (e.getModifierState("Control")) {
                    e.preventDefault();
                    paused = !paused;
                }
                break;

            case "s":
                console.log(getDebugString());
                break;
        }
    }
};

let loopInterval;
loopInterval = setInterval(() => {
    try {
        if (!paused) {
            for (let i = 0; i < 10000; i++) {
                gba?.run();
                if (snagPointInput.value != -1) {
                    if (gba.cpu.executedNum >= snagPointInput.value - 100) {
                        console.log(getDebugString());
                    }
                }
            }
        }
    } catch (e) {
        clearInterval(loopInterval);
        throw e;
    }
}, 10);

document.querySelector('#run-and-log-button').onclick = () => {
    let instrsToRun = document.querySelector('#run-instrs').value;
    let total = 0;
    let msgThreshold = 10000;
    let msgCount = 0;

    function preExecutionHook(ins) {
        if (gba.cpu.cpsrThumbState) {
            log += getDebugString() + `    ${hexN(ins, 4)}\n`;
        } else {
            log += getDebugString() + `${hexN(ins, 8)}\n`;
        }
    }

    try {
        gba.cpu.preExecutionHook = preExecutionHook;
        for (let i = 0; i < instrsToRun; i++) {
            total++;
            if (++msgCount >= msgThreshold) {
                console.log(total);
                msgCount = 0;
            }
            gba?.run();
        }
    } finally {
        gba.cpu.preExecutionHook = null;
        downloadText('ineedhelp.log', log);
    }
};