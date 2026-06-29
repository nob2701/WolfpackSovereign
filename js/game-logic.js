import { Net, runGavelStrikeAnimation } from "./app.js";
import { db, ref, set, get, update, push, onValue } from "./firebase-config.js";

// ==========================================
// 1. TRẠNG THÁI TOÀN CỤC (GLOBAL STATE - G)
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

// Đăng ký sự kiện khởi tạo cấu hình vai trò
document.addEventListener("DOMContentLoaded", () => {
    initRoleSetupListeners();
    initVictoryTabsListeners();
});

// ==========================================
// 2. TỪ ĐIỂN ĐA NGÔN NGỮ (I18N DICTIONARY)
// ==========================================
export const DICT = {
    vi: {
        tab1: "Thành viên", tab2: "Vai Trò", tab3: "Bàn Chơi", tab4: "Lịch Sử", tab5: "Cài đặt",
        t_players: "👥 NGƯỜI CHƠI", t_add_ph: "Nhập tên...", t_add_btn: "Thêm",
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
        t_players: "👥 PLAYERS", t_add_ph: "Enter name...", t_add_btn: "Add",
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
    wolf: '🐺', wolfBoss: '👑', wolfSnow: '❄️', wolfMage: '👁️', traitor: '🕵️', blackDeath: '🦠', phantomWolf: '🐺', clairvoyantWolf: '👁️', mirrorWolf: '🪞', resonanceWolf: '🐺', silencerWolf: '🤫', loneWolf: '🐺', solitaireWolf: '🃏', chaosWolf: '🌪️', bloodline: '🩸',
    demonDetective: '🦇', missionary: '🕍', vampire: '🧛', arsonist: '🔥', eradicator: '⚔️', clown: '🤡', manipulator: '🪄', impostor: '🥸', bountyHunter: '🎯', shark: '🦈', apprenticeReaper: '🪦', serialKiller: '🔪', prime: '👑', ashenKnight: '⚔️', cat: '🐈', reaper: '💀'
};

export const FACTION_ICONS = { villager: '🌾', wolf: '🐺', third: '🧛' };

// ==========================================
// 4. BỘ LỘ HOẠT ĐỘNG GM (ENGINE_MODULE)
// ==========================================
export const Engine_Module = {
    distributeRoles: async () => {
        if (!Net.isHost) return;
        
        const activePlayers = window.G.players;
        if (activePlayers.length < 3) {
            alert(t('msg_need_3'));
            return;
        }

        let rolePool = [];
        for (let key in ROLE_DB) {
            let count = window.G.roleCounts[key] || 0;
            for (let i = 0; i < count; i++) {
                rolePool.push(key);
            }
        }

        while (rolePool.length < activePlayers.length) {
            rolePool.push('villager');
        }

        // Xáo trộn ngẫu nhiên vai trò
        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        const updates = {};
        activePlayers.forEach((p, idx) => {
            const assignedRole = rolePool[idx];
            updates[`rooms/${Net.roomId}/players/${p.id}/role`] = assignedRole;
            updates[`rooms/${Net.roomId}/players/${p.id}/realFaction`] = ROLE_DB[assignedRole].faction;
        });

        try {
            await update(ref(db), updates);
            alert("Trộn và phát vai trò trực tuyến thành công!");
            document.getElementById("btn-gm-start-night")?.classList.remove("hidden");
        } catch (error) {
            alert("Có lỗi xảy ra khi đồng bộ vai trò lên hệ thống!");
        }
    },

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
    },

    // Quản lý đề cử treo cổ (Bước 1)
    accusePlayer: async (targetId) => {
        const selfId = Net.playerId;
        const currentNomRef = ref(db, `rooms/${Net.roomId}/nominations/${selfId}`);
        try {
            const snapshot = await get(currentNomRef);
            if (snapshot.exists() && snapshot.val() === targetId) {
                // Nhấp lại lần nữa để rút đề cử
                await set(currentNomRef, null);
                Engine_Module.logMsg(`${Net.playerName} đã rút đề cử treo cổ.`, "sys");
            } else {
                await set(currentNomRef, targetId);
                Engine_Module.logMsg(`${Net.playerName} đề cử treo cổ đối tượng ${Net.players[targetId]?.name}`, "sys");
                
                // Kiểm tra điều kiện đa số phiếu tuyệt đối (>50% người sống)
                checkMajorityNominationTrigger();
            }
        } catch (error) {
            console.error(error);
        }
    }
};

// Kiểm tra quá bán đề cử để chuyển sang đài Biện hộ (Bước 2)
async function checkMajorityNominationTrigger() {
    const nomRef = ref(db, `rooms/${Net.roomId}/nominations`);
    try {
        const snap = await get(nomRef);
        const nominations = snap.val() || {};
        const aliveCount = window.G.players.filter(p => p.alive).length;
        const majorityThreshold = Math.floor(aliveCount / 2) + 1;

        // Tính toán đếm phiếu
        const counts = {};
        Object.values(nominations).forEach(targetId => {
            counts[targetId] = (counts[targetId] || 0) + 1;
        });

        for (let [targetId, votes] of Object.entries(counts)) {
            if (votes >= majorityThreshold) {
                // Chuyển dịch tức thì sang Biện hộ
                const trialUpdates = {
                    [`rooms/${Net.roomId}/trial`]: {
                        stage: "defense",
                        accusedId: targetId,
                        accusedText: ""
                    }
                };
                await update(ref(db), trialUpdates);
                Engine_Module.logMsg(`Đối tượng [${Net.players[targetId]?.name}] đã nhận đủ số phiếu tố giác tuyệt đối. Chuyển sang pha biện hộ!`, "info");
                break;
            }
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// 5. HIỂN THỊ GIAO DIỆN PHÍA KHÁCH (UI_MODULE)
// ==========================================
export const UI_Module = {
    // Xử lý chuyển tab hiển thị
    switchTab: (idx) => {
        document.body.setAttribute("data-mobile-tab", idx);
        const tabs = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
        tabs.forEach((tabId, i) => {
            const el = document.getElementById(tabId);
            if (el) {
                if (i + 1 === idx) {
                    el.classList.add("active");
                } else {
                    el.classList.remove("active");
                }
            }
        });
    },

    changeLang: (lang) => {
        window.G.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            let key = el.getAttribute('data-i18n');
            if (DICT[lang][key]) el.innerHTML = DICT[lang][key];
        });
        UI_Module.renderRoleConfigPage();
    },

    renderRoleConfigPage: () => {
        const container = document.getElementById('role-config-list');
        if (!container) return;
        container.innerHTML = '';

        // Lọc theo từ khóa tìm kiếm
        let allKeys = Object.keys(ROLE_DB).filter(key => 
            getRoleName(key).toLowerCase().includes(window.G.roleSearchKeyword.toLowerCase())
        );

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

        const totalPages = Math.max(1, Math.ceil(allKeys.length / window.G.rolesPerPage));
        const indicator = document.getElementById('role-page-indicator');
        if (indicator) indicator.innerText = `${window.G.currentRolePage + 1}/${totalPages}`;
    },

    changeRoleQty: (key, delta) => {
        if (!Net.isHost) return;
        const currentQty = window.G.roleCounts[key] || 0;
        const newQty = Math.max(0, currentQty + delta);
        
        update(ref(db, `rooms/${Net.roomId}/roleCounts`), {
            [key]: newQty
        });
    },

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
        let villagePower = 0;
        let wolfPower = 0;
        let thirdPower = 0;

        for (let key in ROLE_DB) {
            const count = window.G.roleCounts[key] || 0;
            if (count > 0) {
                if (ROLE_DB[key].faction === 'villager') villagePower += count;
                else if (ROLE_DB[key].faction === 'wolf') wolfPower += count;
                else if (ROLE_DB[key].faction === 'third') thirdPower += count;
            }
        }

        const total = villagePower + wolfPower + thirdPower || 1;
        const wPct = (wolfPower / total) * 100;
        const tPct = (thirdPower / total) * 100;
        const vPct = (villagePower / total) * 100;

        const wBar = document.getElementById('balance-bar-wolf');
        const tBar = document.getElementById('balance-bar-third');
        const vBar = document.getElementById('balance-bar-village');
        const bText = document.getElementById('balance-text');

        if (wBar) wBar.style.width = `${wPct}%`;
        if (tBar) tBar.style.width = `${tPct}%`;
        if (vBar) vBar.style.width = `${vPct}%`;

        if (bText) {
            if (wolfPower > villagePower) bText.innerText = t('balance_wolf');
            else if (villagePower > wolfPower + thirdPower) bText.innerText = t('balance_village');
            else if (thirdPower > villagePower) bText.innerText = t('balance_third');
            else bText.innerText = t('balance_neutral');
        }
    },

    showRoleInfo: (key) => {
        alert(getRoleName(key) + ": " + (DICT[window.G.lang]['r_' + key] || key));
    },

    // Kích hoạt hiển thị màn hình kết thúc trận đấu và vẽ kết nối hành động đêm SVG
    showVictoryScreen: (winningFaction, mvpData, relationLogs) => {
        const modal = document.getElementById("victory-screen-modal");
        if (!modal) return;
        modal.style.display = "flex";

        const title = document.getElementById("victory-faction-title");
        const artContainer = document.getElementById("victory-visual-art");

        // 2.1 Cài đặt Visual Themes dựa trên phe thắng cuộc
        if (winningFaction === "villager") {
            title.innerText = "🌾 DÂN LÀNG CHIẾN THẮNG 🌾";
            title.style.color = "#16a34a";
            artContainer.innerHTML = `<div style="font-size:72px;">🕊️☀️🌻</div>`;
        } else if (winningFaction === "wolf") {
            title.innerText = "🐺 MA SÓI CHIẾN THẮNG 🐺";
            title.style.color = "#e11d48";
            artContainer.innerHTML = `<div style="font-size:72px;">🐺🩸🌑</div>`;
        } else {
            title.innerText = "🧛 PHE THỨ BA CHIẾN THẮNG 🧛";
            title.style.color = "#c084fc";
            artContainer.innerHTML = `<div style="font-size:72px;">🧛🤡🎭</div>`;
        }

        // Cập nhật thông số MVP và vinh danh danh hiệu hài hước
        const mvpName = document.getElementById("mvp-user-name");
        const mvpBadge = document.getElementById("mvp-badge-title");
        const mvpDetails = document.getElementById("mvp-stats-details");

        if (mvpData) {
            mvpName.innerText = mvpData.name || "Người chơi ẩn danh";
            mvpBadge.innerText = mvpData.badge || "Kẻ Vô Hình";
            
            mvpDetails.innerHTML = "";
            (mvpData.stats || []).forEach(stat => {
                mvpDetails.innerHTML += `
                    <div class="mvp-stat-row">
                        <span>${stat.label}</span>
                        <b>${stat.value}</b>
                    </div>
                `;
            });
        }

        // Chuẩn bị vẽ các đường kết nối SVG
        renderRelationsTab(relationLogs);
    }
};

// Lắng nghe hành vi chuyển tab trên bảng thống kê chi tiết Victory Screen
function initVictoryTabsListeners() {
    const tabs = document.querySelectorAll(".stats-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            const selectedTab = tab.getAttribute("data-stats-tab");
            const panels = ["stats-content-mvp", "stats-content-map", "stats-content-logs"];
            panels.forEach(p => document.getElementById(p).classList.add("hidden"));

            if (selectedTab === "mvp") {
                document.getElementById("stats-content-mvp").classList.remove("hidden");
            } else if (selectedTab === "map") {
                document.getElementById("stats-content-map").classList.remove("hidden");
                triggerSgDrawingRelations();
            } else if (selectedTab === "logs") {
                document.getElementById("stats-content-logs").classList.remove("hidden");
            }
        });
    });

    document.getElementById("btn-show-stats-board")?.addEventListener("click", () => {
        document.getElementById("victory-splash-panel").classList.add("hidden");
        document.getElementById("victory-stats-panel").classList.remove("hidden");
    });

    document.getElementById("btn-stats-back-lobby")?.addEventListener("click", () => {
        location.reload();
    });
}

// Lưu trữ tạm dữ liệu vẽ đường liên kết SVG hành động bảo mật
let cachedRelationLogs = [];

function renderRelationsTab(relationLogs) {
    cachedRelationLogs = relationLogs || [];
    const container = document.getElementById("stats-unmasked-grid");
    if (!container) return;
    container.innerHTML = "";

    // Render danh sách các thẻ người chơi được lật mở đầy đủ vai trò
    window.G.players.forEach(p => {
        container.innerHTML += `
            <div class="player-grid-card" id="relation-card-${p.id}" style="padding: 8px 4px; font-size:11px;">
                <b class="name" style="font-size:11px;">${p.name}</b>
                <span class="role-unmasked" style="font-size:10px;">(${getRoleName(p.role)})</span>
            </div>
        `;
    });
}

// Thực hiện vẽ các đường SVG liên kết (Tơ hồng, Nanh vuốt, Lá chắn bảo hộ)
function triggerSgDrawingRelations() {
    const canvas = document.getElementById("svg-relations-canvas");
    if (!canvas) return;
    canvas.innerHTML = ""; // Clear canvas cũ

    const container = document.getElementById("stats-content-map");
    const containerRect = container.getBoundingClientRect();

    cachedRelationLogs.forEach(log => {
        const fromEl = document.getElementById(`relation-card-${log.fromId}`);
        const toEl = document.getElementById(`relation-card-${log.toId}`);

        if (fromEl && toEl) {
            const fromRect = fromEl.getBoundingClientRect();
            const toRect = toEl.getBoundingClientRect();

            const x1 = (fromRect.left + fromRect.width / 2) - containerRect.left;
            const y1 = (fromRect.top + fromRect.height / 2) - containerRect.top;
            const x2 = (toRect.left + toRect.width / 2) - containerRect.left;
            const y2 = (toRect.top + toRect.height / 2) - containerRect.top;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x1);
            line.setAttribute("y1", y1);
            line.setAttribute("x2", x2);
            line.setAttribute("y2", y2);
            line.setAttribute("stroke-width", "3");

            // Quyết định màu sắc/đặc tính dựa trên kịch bản hành động mật
            if (log.type === "couple") { // Sợi tơ hồng Cupid chọn
                line.setAttribute("stroke", "#f472b6");
                line.setAttribute("stroke-dasharray", "4,4");
            } else if (log.type === "wolf_bite") { // Mũi tên nanh sói
                line.setAttribute("stroke", "#dc2626");
            } else if (log.type === "guard_protect") { // Lá chắn bảo vệ
                line.setAttribute("stroke", "#16a34a");
            } else {
                line.setAttribute("stroke", "#38bdf8");
            }

            canvas.appendChild(line);
        }
    });
}

// Khởi tạo các sự kiện giao diện thiết lập vai trò
function initRoleSetupListeners() {
    document.getElementById("btn-role-prev")?.addEventListener("click", () => {
        if (window.G.currentRolePage > 0) {
            window.G.currentRolePage--;
            UI_Module.renderRoleConfigPage();
        }
    });

    document.getElementById("btn-role-next")?.addEventListener("click", () => {
        let allKeys = Object.keys(ROLE_DB).filter(key => 
            getRoleName(key).toLowerCase().includes(window.G.roleSearchKeyword.toLowerCase())
        );
        const totalPages = Math.ceil(allKeys.length / window.G.rolesPerPage);
        if (window.G.currentRolePage < totalPages - 1) {
            window.G.currentRolePage++;
            UI_Module.renderRoleConfigPage();
        }
    });

    document.getElementById("role-search")?.addEventListener("input", (e) => {
        window.G.roleSearchKeyword = e.target.value;
        window.G.currentRolePage = 0;
        UI_Module.renderRoleConfigPage();
    });

    document.getElementById("preset-classic")?.addEventListener("click", () => {
        applyPreset({ villager: 4, seer: 1, guard: 1, wolf: 2, witch: 1 });
    });

    document.getElementById("preset-lonewolf")?.addEventListener("click", () => {
        applyPreset({ villager: 3, seer: 1, loneWolf: 1, wolf: 1, serialKiller: 1 });
    });

    document.getElementById("btn-distribute")?.addEventListener("click", () => {
        Engine_Module.distributeRoles();
    });

    document.getElementById("btn-gm-start-night")?.addEventListener("click", () => {
        Engine_Module.startGame();
    });
}

function applyPreset(preset) {
    if (!Net.isHost) return;
    const updates = {};
    for (let key in ROLE_DB) {
        updates[`rooms/${Net.roomId}/roleCounts/${key}`] = preset[key] || 0;
    }
    update(ref(db), updates);
}

// Liên kết các hàm toàn cục để UI tương tác trực tiếp từ HTML
window.UI_Module = UI_Module;
window.Engine_Module = Engine_Module;