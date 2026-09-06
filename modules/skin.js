// modules/skin.js
const my_emotes = {
    "1": "909052002", "2": "909052011", "3": "909052012", "4": "909052004",
    "5": "909052007", "6": "909052009", "7": "909052003", "8": "909051001",
    "9": "909052005", "10": "909052001", "11": "909042008", "12": "909041005",
    "13": "909033001", "14": "909038010", "15": "909038012", "16": "909045001",
    "17": "909049010", "18": "909051003", "19": "909000063", "20": "909037011",
    "21": "909049012", "22": "909000002", "23": "909051014", "24": "909050009",
    "25": "909051013", "26": "909051010", "27": "909051004", "28": "909051002",
    "29": "909048015", "30": "909051001", "31": "909044015", "32": "909041008",
    "33": "909049003", "34": "909050008", "35": "909049001", "36": "909041013",
    "37": "909050014", "38": "909050015", "39": "909050002", "40": "909000034",
    "41": "909000012", "42": "909000020", "43": "909000014", "44": "909000010",
    "45": "909038004", "46": "909040004", "47": "909041012", "48": "909041003",
    "49": "909000084", "50": "909000142", "51": "909000086", "52": "909000087",
    "53": "909000088", "54": "909000095", "55": "909000125", "56": "909000129",
    "57": "909000130", "58": "909000135", "59": "909000143", "60": "909034003",
    "61": "909033005", "62": "909000034", "63": "909000039", "64": "909000055",
    "65": "909000064", "66": "909000071", "67": "909000074", "68": "909000080",
    "69": "909034009", "70": "909035006", "71": "909034014", "72": "909035001",
    "73": "909035002", "74": "909035003", "75": "909035010", "76": "909036001",
    "77": "909036002", "78": "909036004", "79": "909036008", "80": "909036010",
    "81": "909037003", "82": "909037004", "83": "909037009", "84": "909038001",
    "85": "909037002", "86": "909037006", "87": "909037008", "88": "909037010",
    "89": "909037011", "90": "909038003", "91": "909038006", "92": "909038008",
    "93": "909038011", "94": "909039004", "95": "909039006", "96": "909040001",
    "97": "909052012", "98": "909040004", "99": "909040005", "100": "909052002"
};

function init(app) {
    app.post('/GetPlayerPersonalShow', (req, res, next) => {
        const originalSend = res.send;
        res.send = function(data) {
            try {
                const json = JSON.parse(data.toString());
                
                if (!json.emotes) json.emotes = {};
                if (!json.emotes.list) json.emotes.list = [];
                
                const emoteIds = Object.values(my_emotes);
                for (const id of emoteIds) {
                    if (!json.emotes.list.includes(id)) {
                        json.emotes.list.push(id);
                    }
                }
                
                const modified = Buffer.from(JSON.stringify(json));
                res.setHeader('Content-Length', modified.length);
                originalSend.call(this, modified);
            } catch(e) {
                originalSend.call(this, data);
            }
        };
        next();
    });

    app.post('/GetAvatarInfo', (req, res, next) => {
        const originalSend = res.send;
        res.send = function(data) {
            try {
                const json = JSON.parse(data.toString());
                
                if (!json.avatars) json.avatars = [];
                
                const avatarIds = Object.values(my_emotes).slice(0, 20);
                for (const id of avatarIds) {
                    if (!json.avatars.includes(id)) {
                        json.avatars.push(id);
                    }
                }
                
                const modified = Buffer.from(JSON.stringify(json));
                res.setHeader('Content-Length', modified.length);
                originalSend.call(this, modified);
            } catch(e) {
                originalSend.call(this, data);
            }
        };
        next();
    });

    app.post('/GetClothesInfo', (req, res, next) => {
        const originalSend = res.send;
        res.send = function(data) {
            try {
                const json = JSON.parse(data.toString());
                
                if (!json.clothes) json.clothes = [];
                
                const clothesIds = Object.values(my_emotes).slice(0, 30);
                for (const id of clothesIds) {
                    if (!json.clothes.includes(id)) {
                        json.clothes.push(id);
                    }
                }
                
                const modified = Buffer.from(JSON.stringify(json));
                res.setHeader('Content-Length', modified.length);
                originalSend.call(this, modified);
            } catch(e) {
                originalSend.call(this, data);
            }
        };
        next();
    });

    app.post('/GetWeaponSkinInfo', (req, res, next) => {
        const originalSend = res.send;
        res.send = function(data) {
            try {
                const json = JSON.parse(data.toString());
                
                if (!json.weapons) json.weapons = [];
                
                const weaponIds = Object.values(my_emotes).slice(0, 25);
                for (const id of weaponIds) {
                    if (!json.weapons.includes(id)) {
                        json.weapons.push(id);
                    }
                }
                
                const modified = Buffer.from(JSON.stringify(json));
                res.setHeader('Content-Length', modified.length);
                originalSend.call(this, modified);
            } catch(e) {
                originalSend.call(this, data);
            }
        };
        next();
    });
}

module.exports = { init, my_emotes };