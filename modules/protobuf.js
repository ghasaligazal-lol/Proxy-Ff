// modules/protobuf.js
const path = require('path');
const protobuf = require('protobufjs');

let AccountPersonalShowInfo = null;
let isLoaded = false;

function init(app) {
    protobuf.load(path.join(__dirname, '..', 'AccountPersonalShow.proto'))
        .then(root => {
            AccountPersonalShowInfo = root.lookupType('freefire.AccountPersonalShowInfo');
            isLoaded = true;
            console.log('[PROTOBUF] Loaded successfully');
        })
        .catch(err => {
            console.log(`[PROTOBUF] Load error: ${err.message}`);
        });
}

function parseAccountInfo(bufferData) {
    if (!isLoaded || !Buffer.isBuffer(bufferData) || bufferData.length === 0) {
        return null;
    }

    try {
        const message = AccountPersonalShowInfo.decode(bufferData);
        const object = AccountPersonalShowInfo.toObject(message, {
            longs: String,
            enums: String,
            bytes: String,
            defaults: true
        });

        const basic = object.basic_info || {};
        const clan = object.clan_basic_info || {};
        const pet = object.pet_info || {};
        const social = object.social_info || {};

        const lastLoginStr = basic.last_login_at
            ? new Date(Number(basic.last_login_at) * 1000).toLocaleString('en-GB', { timeZoneName: 'short' })
            : 'Not Found';

        const createdAtStr = basic.create_at
            ? new Date(Number(basic.create_at) * 1000).toLocaleString('en-GB', { timeZoneName: 'short' })
            : 'Not Found';

        console.log(`
Account Information:
┌ Basic Information:
├─ Prime Level: 0
├─ Name: ${basic.nickname || 'Not Found'}
├─ UID: ${basic.account_id || 'Not Found'}
├─ Level: ${basic.level || 0} (Exp: ${basic.exp || 0})
├─ Region: ${basic.region || 'ID'}
├─ Likes: ${basic.liked || 0}
├─ Honor Score: 100
├─ Celebrity Status: False
├─ Title Name: Not Found
└─ Signature: ${social.signature || 'Battle In Style!'}

┌ Activity Information:
├─ Most Recent OB: OB54
├─ Booyah Pass: Basic
├─ Current Bp Badges: ${basic.badge_cnt || 0}
├─ Br Rank: ${basic.rank || 'Bronze I'}
├─ Cs Rank: ${basic.cs_rank || 'Bronze I'}
├─ Gender: ${social.gender || 'Confidential'}
├─ Show Rank: BrRanked
├─ Show Br Rank: ${basic.show_br_rank ? 'True' : 'False'}
├─ Show Cs Rank: ${basic.show_cs_rank ? 'True' : 'False'}
├─ Created At: ${createdAtStr}
└─ Last Login: ${lastLoginStr}

┌ Overview Information:
├─ Avatar Name: Not Found
├─ Banner Name: Not Found
├─ Pin Name: Not Found
├─ Active Time: Flexible
├─ Active Days: Flexible
├─ Mode Prefer: ${social.mode_prefer || 'No Preference'}
├─ Equipped Skills: Not Equipped
├─ Language: ${social.language || 'Indonesian'}
├─ Equipped Battle Card Name: Not Equipped
├─ Equipped Gun Name: Not Found
├─ Equipped Animation Name: Not Found
├─ Transform Animation Name: Not Found
└─ Outfits: Graphically Presented Below

┌ Pet Details:
├─ Equipped?: ${pet.id ? 'Yes' : 'No'}
├─ Pet Name: ${pet.name || 'Not Found'}
├─ Pet Type: ${pet.name || 'Not Found'}
├─ Pet Exp: ${pet.exp || 0}
└─ Pet Level: ${pet.level || 0}

┌ Guild Information:
├─ Guild Name: ${clan.clan_name || 'Not Found'}
├─ Guild ID: ${clan.clan_id || 'Not Found'}
├─ Guild Level: ${clan.clan_level || 'Not Found'}
├─ Live Members: Not Found
└─ Leader Information:
    ├─ Leader Name: Not Found
    ├─ Leader UID: Not Found
    ├─ Leader Level: Not Found
    ├─ Leader Region: Not Found
    ├─ Leader Booyah Pass: Not Found
    ├─ Leader Created At: Not Found
    ├─ Leader Last Login: Not Found
    ├─ Leader Most Recent OB: Not Found
    ├─ Leader Title Name: Not Found
    ├─ Leader Current Bp Badges: Not Found
    ├─ Leader Br Rank: Not Found
    └─ Leader Cs Rank: Not Found

┌ Public Craftland Maps
Not Found
        `);
        return object;
    } catch (err) {
        console.log(`[PROTOBUF] Parse error: ${err.message}`);
        return null;
    }
}

function parseRegister(bufferData) {
    if (!Buffer.isBuffer(bufferData) || bufferData.length === 0) return null;
    try {
        const text = bufferData.toString('utf-8');
        const uidMatch = text.match(/\b(\d{9,11})\b/);
        if (uidMatch) {
            console.log(`[REGISTER] UID: ${uidMatch[1]}`);
            return { uid: uidMatch[1] };
        }
        return null;
    } catch (err) {
        return null;
    }
}

module.exports = { init, parseAccountInfo, parseRegister, get AccountPersonalShowInfo() { return AccountPersonalShowInfo; }, get isLoaded() { return isLoaded; } };