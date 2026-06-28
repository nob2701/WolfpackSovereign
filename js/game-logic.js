import { Net, dbSendNightAction, dbCastDayVote } from "./app.js";
import { db, ref, set, get, update, push } from "./firebase-config.js";

// ==========================================
// 1. KHỞI TẠO TRẠNG THÁI TOÀN CỤC CỦA GAME (G)
// ==========================================
window.G = {
    lang: 'vi',
    players: [],
    day: 0,
    phase: 'setup',
    mayor: null,
    clownWon: false,
    gameMode: 'custom',
    loneWolfDayLimit: 3,
    apprenticeMayor: null,
    apprenticeMayorVoteActive: false,
    roleCounts: {},
    roleSearchKeyword: "",
    currentRolePage: 0,
    rolesPerPage: 4,
    gameTimeline: [],
    playerStats: {}
};

// ==========================================
// 2. TỪ ĐIỂN ĐA NGÔN NGỮ (I18N DICTIONARY)
// ==========================================
export const DICT = {
    vi: {
        tab1: "Players", tab2: "Roles", tab3: "Board", tab4: "Lịch Sử", tab5: "Cài đặt",
        t_players: "👥 NGƯỜI CHƠI", t_add_ph: "Nhập tên...", t_add_btn: "Thêm", t_drag_hint: "Trạng thái trực tuyến đồng bộ liên tục",
        t_load: "Tải DS", t_save: "Lưu DS", t_delete: "Xoá DS",
        t_role_config: "⚙️ CẤU HÌNH ROLE", t_btn_dist: "🎲 Trộn & Phát Role", t_search_role: "Tìm kiếm role...", t_active_roles: "Role được sử dụng: ",
        t_preset_title: "CHẾ ĐỘ CHƠI:", t_mode_classic: "Classic Mode", t_mode_lonewolf: "A Waltz Among Wolves",
        t_balance_meter: "CÁN CÂN TRẬN ĐẤU:", balance_wolf: "Sói Áp Đảo (Game Nhanh)", balance_village: "Làng Thắng Thế", balance_third: "Phe Thứ 3 Nguy Hiểm", balance_neutral: "Cân Bằng",
        t_board: "🎮 BÀN ĐIỀU KHIỂN", t_setup_phase: "ĐANG SET UP GAME", t_mayor: "Trưởng Làng:", t_no_mayor: "Chưa có", t_start_game: "🚀 BẮT ĐẦU", t_setup_guide: "Đang chờ chủ phòng thiết lập vai trò trực tuyến...",
        t_secrets: "🕵️ BÍ MẬT & PHE PHÁI", t_villagers: "🌾 DÂN LÀNG", t_wolves: "🐺 MA SÓI", t_thirds: "🧛 PHE THỨ 3", t_empty: "<i>Trống</i>",
        t_log: "📜 LỊCH SỬ SỰ KIỆN", t_settings: "⚙️ CÀI ĐẶT HỆ THỐNG", t_close: "Đóng", t_theme: "🎨 GIAO DIỆN MÀU SẮC", t_time: "⏱️ THỜI GIAN THẢO LUẬN BAN NGÀY", t_lang: "🌐 NGÔN NGỮ / LANGUAGE", t_font: "🔤 PHÔNG CHỮ / FONT",
        r_villager: 'Dân Làng', r_seer: 'Tiên Tri', r_guard: 'Bảo Vệ', r_witch: 'Phù Thủy', r_hunter: 'Thợ Săn', r_cupid: 'Cupid', r_halfWolf: 'Bán Sói', r_headlessKnight: 'Hiệp Sĩ Không Đầu', r_apprenticeSeer: 'Tiên Tri Tập Sự', r_ghost: 'Con Ma', r_doppelganger: 'Song Trùng', r_avenger: 'Kẻ Báo Thù', r_paradox: 'Kẻ Nghịch Hành', r_lostChild: 'Đứa Con Thất Lạc', r_carver: 'Kẻ Khắc Tên', r_guarantor: 'Người Bảo Lãnh', r_reflector: 'Kẻ Phản Chiếu', r_thief: 'Tên Trộm', r_fugitive: 'Kẻ Đào Tẩu', r_cryptoMiner: 'Kẻ Đào Coin', r_reverser: 'Người Đảo Ngược', r_glitch: 'Bản Sao Lỗi', r_police: 'Cảnh Sát Trưởng', r_spy: 'Gián Điệp', r_angel: 'Thiên Sứ', r_sovereign: 'Kẻ Độc Tôn', r_demonologist: 'Nhà Ngoại Cảm', r_parrot: 'Vẹt', r_ember: 'Kẻ Độc Hành',
        r_wolf: 'Ma Sói', r_wolfBoss: 'Sói Trùm', r_wolfSnow: 'Sói Tuyết', r_wolfMage: 'Pháp Sư Sói', r_traitor: 'Kẻ Phản Bội', r_blackDeath: 'Cái Chết Đen', r_phantomWolf: 'Sói Ảo Ảnh', r_clairvoyantWolf: 'Sói Thấu Thị', r_mirrorWolf: 'Sói Gương', r_resonanceWolf: 'Sói Cộng Hưởng', r_silencerWolf: 'Sói Câm Lặng', r_loneWolf: 'Sói Cô Độc', r_solitaireWolf: 'Sói Tarot', r_chaosWolf: 'Sói Hỗn Mang', r_bloodline: 'Sói Già',
        r_demonDetective: 'Thám Tử Ác Ma', r_missionary: 'Nhà Truyền Giáo', r_vampire: 'Ma Cà Rồng', r_arsonist: 'Kẻ Phóng Hỏa', r_eradicator: 'Kẻ Thanh Trừng', r_clown: 'Gã Hề', r_manipulator: 'Kẻ Thao Túng', r_impostor: 'Kẻ Mạo Danh', r_bountyHunter: 'Thợ Săn Tiền Thưởng', r_shark: 'Cá Mập Tài Chính', r_apprenticeReaper: 'Thần Chết Tập Sự', r_serialKiller: 'Sát Nhân', r_prime: 'Chủ Thần',
        r_ashenKnight: 'Kỵ Sĩ Tro Tàn', r_cat: 'Mèo', r_reaper: 'Tử Thần',
        alert_btn: "Đã Hiểu",
        msg_need_3: "Cần tối thiểu 3 người kết nối trực tuyến!",
        msg_game_start: "🚀 TRẬN ĐẤU CHÍNH THỨC BẮT ĐẦU!",
        phase_night: "🌙 ĐÊM SỐ {0}", phase_day: "☀️ BAN NGÀY SỐ {0}",
        ui_dead_count: "Đêm qua có {0} người tử vong", ui_dead_names: "Nạn nhân xấu số: {0}"
    },
    en: {
        tab1: "Players", tab2: "Roles", tab3: "Board", tab4: "Log", tab5: "Settings",
        t_players: "👥 PLAYERS", t_add_ph: "Enter name...", t_add_btn: "Add", t_drag_hint: "Online connection synced in real-time",
        t_load: "Load", t_save: "Save", t_delete: "Delete",
        t_role_config: "⚙️ ROLE CONFIG", t_btn_dist: "🎲 Shuffle & Distribute", t_search_role: "Search roles...", t_active_roles: "Roles in play: ",
        t_preset_title: "GAME MODES:", t_mode_classic: "Classic Mode", t_mode_lonewolf: "A Waltz Among Wolves",
        t_balance_meter: "BALANCE METER:", balance_wolf: "🐺 Wolf-Favored", balance_village: "🌾 Village-Favored", balance_third: "🧛 3rd Party", balance_neutral: "⚖️ Balanced",
        t_board: "🎮 BOARD", t_setup_phase: "GAME SETUP", t_mayor: "Mayor:", t_no_mayor: "None", t_start_game: "🚀 START", t_setup_guide: "Waiting for host to setup roles...",
        t_secrets: "🕵️ SECRETS & FACTIONS", t_villagers: "🌾 VILLAGERS", t_wolves: "🐺 WOLVES", t_thirds: "🧛 3RD PARTY", t_empty: "<i>Empty</i>",
        t_log: "📜 EVENT LOG", t_settings: "⚙️ SYSTEM SETTINGS", t_close: "Close", t_theme: "🎨 UI THEME", t_time: "⏱️ DAY DISCUSSION TIME", t_lang: "🌐 LANGUAGE", t_font: "🔤 FONT",
        r_villager: 'Villager', r_seer: 'Seer', r_guard: 'Guard', r_witch: 'Witch', r_hunter: 'Hunter', r_cupid: 'Cupid', r_halfWolf: 'Half Wolf', r_headlessKnight: 'Headless Knight', r_apprenticeSeer: 'Apprentice Seer', r_ghost: 'Ghost', r_doppelganger: 'Doppelganger', r_avenger: 'The Avenger', r_paradox: 'The Paradox', r_lostChild: 'The Lost Child', r_carver: 'The Carver', r_guarantor: 'The Guarantor', r_reflector: 'The Reflector', r_thief: 'Thief', r_fugitive: 'Fugitive', r_cryptoMiner: 'Crypto Miner', r_reverser: 'The Reverser', r_glitch: 'The Glitch', r_police: 'Sheriff', r_spy: 'Spy', r_angel: 'Angel', r_sovereign: 'The Sovereign', r_demonologist: 'Demonologist', r_parrot: 'Parrot', r_ember: 'The Soloist',
        r_wolf: 'Werewolf', r_wolfBoss: 'Wolf Boss', r_wolfSnow: 'Snow Wolf', r_wolfMage: 'Wolf Mage', r_traitor: 'Traitor', r_blackDeath: 'Black Death', r_phantomWolf: 'Phantom Wolf', r_clairvoyantWolf: 'Clairvoyant Wolf', r_mirrorWolf: 'Mirror Wolf', r_resonanceWolf: 'Resonance Wolf', r_silencerWolf: 'Silencer Wolf', r_loneWolf: 'Lone Wolf', r_solitaireWolf: 'Solitaire Wolf', r_chaosWolf: 'Chaos Wolf', r_bloodline: 'Elder Wolf',
        r_demonDetective: 'Demon Detective', r_missionary: 'Missionary', r_vampire: 'Vampire', r_arsonist: 'Arsonist', r_eradicator: 'Eradicator', r_clown: 'Clown', r_manipulator: 'The Manipulator', r_impostor: 'The Impostor', r_bountyHunter: 'Bounty Hunter', r_shark: 'Shark', r_apprenticeReaper: 'Apprentice Reaper', r_serialKiller: 'Serial Killer', r_prime: 'The Prime',
        r_ashenKnight: 'Ashen Knight', r_cat: 'Cat', r_reaper: 'The Reaper',
        alert_btn: "Got it",
        msg_need_3: "Need at least 3 players connected online!",
        msg_game_start: "🚀 GAME HAS BEGUN!",
        phase_night: "🌙 NIGHT {0}", phase_day: "☀️ DAY {0}",
        ui_dead_count: "{0} players died last night", ui_dead_names: "Victims: {0}"
    }
};

export const getRoleName = (key) => DICT[window.G.lang]['r_' + key] || key;
export const t = (key, ...args) => {
    let text = DICT[window.G.lang][key] || key;
    args.forEach((arg, i) => { text = text.replace(`{${i}}`, arg); });
    return text;
};

// ==========================================
// 3. ĐỊNH NGHĨA SỐ LIỆU CẤU HÌNH VAI TRÒ
// ==========================================
export const ROLE_DB = {
    villager: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    seer: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    guard: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    witch: { faction: 'villager', flags: { isEvil: true, isStealable: true } }, 
    hunter: { faction: 'villager', flags: { isEvil: true, isStealable: true } }, 
    cupid: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    halfWolf: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    headlessKnight: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    apprenticeSeer: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    ghost: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    doppelganger: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    avenger: { faction: 'villager', flags: { isEvil: true, isStealable: true } }, 
    paradox: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    lostChild: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    carver: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    guarantor: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    reflector: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    thief: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    fugitive: { faction: 'villager', flags: { isEvil: false, isStealable: false } }, 
    cryptoMiner: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    reverser: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    glitch: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    police: { faction: 'villager', flags: { isEvil: true, isStealable: true } }, 
    spy: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    angel: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    sovereign: { faction: 'villager', flags: { isEvil: true, isStealable: true } }, 
    demonologist: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    parrot: { faction: 'villager', flags: { isEvil: false, isStealable: true } }, 
    ember: { faction: 'villager', flags: { isEvil: false, isStealable: false } },
    wolf: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    wolfBoss: { faction: 'wolf', flags: { isEvil: false, isStealable: false } }, 
    wolfSnow: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    wolfMage: { faction: 'wolf', flags: { isEvil: true, isStealable: true } }, 
    traitor: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    blackDeath: { faction: 'wolf', flags: { isEvil: false, isStealable: false } }, 
    phantomWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: true } }, 
    clairvoyantWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    mirrorWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    resonanceWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    silencerWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: true } }, 
    loneWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: true } }, 
    solitaireWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: true } }, 
    chaosWolf: { faction: 'wolf', flags: { isEvil: true, isStealable: false } }, 
    bloodline: { faction: 'wolf', flags: { isEvil: true, isStealable: true } },
    demonDetective: { faction: 'third', flags: { isEvil: true, isStealable: true } }, 
    missionary: { faction: 'third', flags: { isEvil: false, isStealable: false } }, 
    vampire: { faction: 'third', flags: { isEvil: true, isStealable: false } }, 
    arsonist: { faction: 'third', flags: { isEvil: true, isStealable: false } }, 
    eradicator: { faction: 'third', flags: { isEvil: false, isStealable: true } }, 
    clown: { faction: 'third', flags: { isEvil: false, isStealable: true } }, 
    manipulator: { faction: 'third', flags: { isEvil: false, isStealable: true } }, 
    impostor: { faction: 'third', flags: { isEvil: false, isStealable: true } }, 
    bountyHunter: { faction: 'third', flags: { isEvil: false, isStealable: false } }, 
    shark: { faction: 'third', flags: { isEvil: false, isStealable: false } }, 
    apprenticeReaper: { faction: 'third', flags: { isEvil: false, isStealable: true } }, 
    serialKiller: { faction: 'third', flags: { isEvil: true, isStealable: true } }, 
    prime: { faction: 'third', flags: { isEvil: false, isStealable: false } }, 
    ashenKnight: { faction: 'third', flags: { isEvil: false, isStealable: false } }, 
    cat: { faction: 'third', flags: { isEvil: true, isStealable: true } }, 
    reaper: { faction: 'third', flags: { isEvil: true, isStealable: false } }
};

export const ROLE_ICONS = {
    villager: '🌾', seer: '🔮', guard: '🛡️', witch: '🧪', hunter: '🏹', cupid: '💘', halfWolf: '🐺', headlessKnight: '🎃', apprenticeSeer: '👁️', ghost: '👻', thief: '🦹', doppelganger: '🎭', avenger: '⚔️', paradox: '⏳', lostChild: '👶', carver: '🔪', guarantor: '🤝', reflector: '🪞', fugitive: '🏃', cryptoMiner: '⛏️', reverser: '🔄', glitch: '👾', police: '🔫', spy: '🕵️', angel: '👼', sovereign: '👑', demonologist: '🧿', parrot: '🦜', ember: '🔥',
    wolf: '🐺', wolfBoss: '👑', wolfSnow: '❄️', wolfMage: '👁️‍عون', traitor: '🕵️', blackDeath: '🦠', phantomWolf: '🐺', clairvoyantWolf: '👁️', mirrorWolf: '🪞', resonanceWolf: '🐺', silencerWolf: '🤫', loneWolf: '🐺', solitaireWolf: '🃏', chaosWolf: '🌪️', bloodline: '🩸',
    demonDetective: '🦇', missionary: '🕍', vampire: '🧛', arsonist: '🔥', eradicator: '⚔️', clown: '🤡', manipulator: '🪄', impostor: '🥸', bountyHunter: '🎯', shark: '🦈', apprenticeReaper: '🪦', serialKiller: '🔪', prime: '👑', ashenKnight: '⚔️', cat: '🐈', reaper: '💀'
};

export const FACTION_ICONS = { villager: '🌾', wolf: '🐺', third: '🧛' };

// ==========================================
// 4. BỘ LỘ HOẠT ĐỘNG GM (ENGINE_MODULE)
// ==========================================
export const Engine_Module = {
    // 1. Phân phối vai trò trực tuyến
    distributeRoles: async () => {
        if (!Net.isHost) return;
        
        const activePlayers = window.G.players;
        if (activePlayers.length < 3) {
            alert(t('msg_need_3'));
            return;
        }

        // Tạo danh sách bể vai trò dựa trên cấu hình host chọn
        let rolePool = [];
        for (let key in ROLE_DB) {
            let count = window.G.roleCounts[key] || 0;
            for (let i = 0; i < count; i++) {
                rolePool.push(key);
            }
        }

        // Tự động lấp đầy bể bằng Dân Làng nếu thiếu cấu hình
        while (rolePool.length < activePlayers.length) {
            rolePool.push('villager');
        }

        // Trộn ngẫu nhiên vai trò
        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        // Lưu thông tin phân phối vai trò trực tuyến lên Firebase
        const updates = {};
        activePlayers.forEach((p, idx) => {
            const assignedRole = rolePool[idx];
            updates[`rooms/${Net.roomId}/players/${p.id}/role`] = assignedRole;
            updates[`rooms/${Net.roomId}/players/${p.id}/realFaction`] = ROLE_DB[assignedRole].faction;
        });

        try {
            await update(ref(db), updates);
            alert("Trộn và phát vai trò trực tuyến thành công!");
        } catch (error) {
            alert("Có lỗi xảy ra khi đồng bộ vai trò lên hệ thống!");
        }
    },

    // 2. Kích hoạt trò chơi
    startGame: async () => {
        if (!Net.isHost) return;

        const updates = {
            [`rooms/${Net.roomId}/meta/started`]: true,
            [`rooms/${Net.roomId}/meta/day`]: 1,
            [`rooms/${Net.roomId}/meta/phase`]: "night"
        };

        try {
            await update(ref(db), updates);
            Engine_Module.logMsg(t('msg_game_start'), "info");
        } catch (error) {
            alert("Không thể khởi động game!");
        }
    },

    // 3. Ghi chép lịch sử sự kiện đồng bộ lên Server
    logMsg: async (msg, type = "sys") => {
        if (!Net.roomId) return;
        const logRef = ref(db, `rooms/${Net.roomId}/logs`);
        const logItem = {
            day: window.G.day,
            phase: window.G.phase,
            msg: msg,
            type: type,
            timestamp: Date.now()
        };
        try {
            await push(logRef, logItem);
        } catch (error) {
            console.error("Lỗi ghi log trực tuyến:", error);
        }
    }
};

// ==========================================
// 5. HIỂN THỊ GIAO DIỆN PHÍA KHÁCH (UI_MODULE)
// ==========================================
export const UI_Module = {
    // Thay đổi ngôn ngữ cục bộ
    changeLang: (lang) => {
        window.G.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            let key = el.getAttribute('data-i18n');
            if (DICT[lang][key]) el.innerHTML = DICT[lang][key];
        });
        UI_Module.renderRoleConfigPage();
    },

    // Cập nhật cấu hình bảng chọn số lượng Role
    renderRoleConfigPage: () => {
        const container = document.getElementById('role-config-list');
        if (!container) return;
        container.innerHTML = '';

        let allKeys = Object.keys(ROLE_DB);
        let start = window.G.currentRolePage * window.G.rolesPerPage;
        let pageKeys = allKeys.slice(start, start + window.G.rolesPerPage);

        pageKeys.forEach(key => {
            const faction = ROLE_DB[key].faction;
            const fIcon = FACTION_ICONS[faction] || '';
            const qty = window.G.roleCounts[key] || 0;

            container.innerHTML += `
            <div class="role-config-row">
                <span style="flex:1; display:flex; align-items:center; gap:8px;">
                    <button class="btn-info-role" onclick="UI_Module.showRoleInfo('${key}')">?</button>
                    <span>${fIcon}</span>
                    <span>${getRoleName(key)}</span>
                </span>
                <div style="display:flex; align-items:center; gap:5px;">
                    <button class="btn-qty" onclick="UI_Module.changeRoleQty('${key}', -1)">-</button>
                    <div class="role-qty-box">${qty}</div>
                    <button class="btn-qty" onclick="UI_Module.changeRoleQty('${key}', 1)">+</button>
                </div>
            </div>`;
        });

        // Thiết lập trang
        const totalPages = Math.ceil(allKeys.length / window.G.rolesPerPage);
        const indicator = document.getElementById('role-page-indicator');
        if (indicator) indicator.innerText = `${window.G.currentRolePage + 1}/${totalPages}`;
    },

    changeRoleQty: (key, delta) => {
        if (!Net.isHost) return;
        const currentQty = window.G.roleCounts[key] || 0;
        const newQty = Math.max(0, currentQty + delta);
        
        // Cập nhật trực tiếp lên Firebase để đồng bộ tức thì
        update(ref(db, `rooms/${Net.roomId}/roleCounts`), {
            [key]: newQty
        });
    },

    // Cập nhật bảng người chơi đồng bộ từ Firebase
    renderPlayers: () => {
        const list = document.getElementById('players-list');
        if (!list) return;

        let html = '';
        window.G.players.forEach((p, index) => {
            const statusIcon = p.isConnected ? '<span class="online-dot"></span>' : '<span class="offline-dot"></span>';
            const rowClass = `player-row ${p.alive ? '' : 'dead'}`;
            
            let actionBtn = '';
            if (p.alive && Net.isHost && window.G.phase !== "setup") {
                actionBtn = `<button class="btn-danger btn-small" onclick="UI_Module.executeDeath('${p.id}')">Xử tử</button>`;
            }

            html += `
            <div class="${rowClass}">
                <span style="font-weight:bold;">${statusIcon} ${index + 1}. ${p.name}</span>
                <div style="display:flex; gap:5px; align-items:center;">
                    <span style="font-size:12px; opacity:0.7;">(${getRoleName(p.role)})</span>
                    ${actionBtn}
                </div>
            </div>`;
        });
        list.innerHTML = html;
    },

    // Thực thi xử tử thủ công từ GM Host
    executeDeath: async (playerId) => {
        if (!confirm("Bạn có chắc chắn muốn xử tử thủ công người chơi này?")) return;
        const playerRef = ref(db, `rooms/${Net.roomId}/players/${playerId}`);
        try {
            await update(playerRef, { alive: false });
            Engine_Module.logMsg(`Người chơi [${window.G.players.find(p=>p.id===playerId).name}] bị Quản trò xử tử thủ công.`, "kill");
        } catch (error) {
            alert("Lỗi thực thi lệnh tử hình!");
        }
    },

    // Cập nhật tổng quan phòng
    updateStats: () => {
        const pCountDisp = document.getElementById('player-count-display');
        const pCount = document.getElementById('player-count');
        if (pCountDisp) pCountDisp.innerText = window.G.players.length;
        if (pCount) pCount.innerText = window.G.players.length;
    },

    updateActiveRolesSummary: () => {
        const summary = document.getElementById('active-roles-summary');
        if (!summary) return;

        let activeStr = [];
        for (let key in ROLE_DB) {
            let count = window.G.roleCounts[key] || 0;
            if (count > 0) activeStr.push(`${getRoleName(key)} x${count}`);
        }
        summary.innerText = t('t_active_roles') + (activeStr.length ? activeStr.join(', ') : 'Trống');
    },

    updateBalanceUI: () => {
        // Cán cân trận đấu tương tự bản gốc v46
    },

    showRoleInfo: (key) => {
        alert(t('r_' + key) + ": " + (DICT[window.G.lang]['r_' + key] || key));
    }
};

// Liên kết các hàm toàn cục để UI tương tác trực tiếp
window.UI_Module = UI_Module;
window.Engine_Module = Engine_Module;