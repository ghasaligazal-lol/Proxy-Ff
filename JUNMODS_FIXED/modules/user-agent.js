// modules/user-agent.js
const userAgents = [
    // Samsung
    'Dalvik/2.1.0 (Linux; U; Android 11; SM-G998B Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 12; SM-G990E Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 13; SM-A536E Build/TP1A.220624.014)',
    'Dalvik/2.1.0 (Linux; U; Android 11; SM-M127G Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 12; SM-E225F Build/SP1A.210812.016)',
    
    // Xiaomi
    'Dalvik/2.1.0 (Linux; U; Android 12; M2010J19SG Build/SKQ1.210908.001)',
    'Dalvik/2.1.0 (Linux; U; Android 13; M2101K7BG Build/TKQ1.220829.002)',
    'Dalvik/2.1.0 (Linux; U; Android 11; M2007J20CG Build/RKQ1.200826.002)',
    'Dalvik/2.1.0 (Linux; U; Android 12; 2201116TG Build/SKQ1.211019.001)',
    'Dalvik/2.1.0 (Linux; U; Android 13; 22111317G Build/TKQ1.221013.002)',
    
    // Oppo
    'Dalvik/2.1.0 (Linux; U; Android 11; CPH2239 Build/RP1A.200720.011)',
    'Dalvik/2.1.0 (Linux; U; Android 12; CPH2251 Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 13; CPH2269 Build/TP1A.220624.014)',
    'Dalvik/2.1.0 (Linux; U; Android 11; CPH2185 Build/RP1A.200720.011)',
    
    // Vivo
    'Dalvik/2.1.0 (Linux; U; Android 12; V2204 Build/SP1A.210812.016)',
    'Dalvik/2.1.0 (Linux; U; Android 11; V2036 Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 13; V2244 Build/TP1A.220624.014)',
    
    // Realme
    'Dalvik/2.1.0 (Linux; U; Android 11; RMX2151 Build/RP1A.200720.011)',
    'Dalvik/2.1.0 (Linux; U; Android 12; RMX3461 Build/SP1A.210812.016)',
    
    // Asus
    'Dalvik/2.1.0 (Linux; U; Android 11; ASUS_I005DA Build/RP1A.200720.012)',
    'Dalvik/2.1.0 (Linux; U; Android 12; ASUS_AI2201_B Build/SP1A.210812.016)',
    
    // Nothing
    'Dalvik/2.1.0 (Linux; U; Android 13; A063 Build/TKQ1.221013.002)',
    
    // Pixel
    'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.231205.015)',
    'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Pro Build/UQ1A.240105.004)',
];

// Accept-Language biar match sama region
const languages = ['id-ID', 'en-US', 'th-TH', 'vi-VN', 'ms-MY', 'zh-TW'];

function getRandomUserAgent() {
    const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
    const lang = languages[Math.floor(Math.random() * languages.length)];
    return { ua, lang };
}

function getRandomDeviceId() {
    // Bikin device ID random 16 karakter hex
    return Math.random().toString(16).substring(2, 18);
}

function getRandomAndroidId() {
    // Android ID 16 karakter hex
    return Math.random().toString(16).substring(2, 18);
}

module.exports = {
    userAgents,
    languages,
    getRandomUserAgent,
    getRandomDeviceId,
    getRandomAndroidId
};