/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - GAME LOGIC & UI MODULE (EXHAUSTIVE & FULL)
 * =========================================================================
 * Quản lý Cơ sở dữ liệu 61 Vai trò, Từ điển Song ngữ (VI/EN), Engine phân phát Bài,
 * Bảng cấu hình Role Config, Cán cân Trận đấu, UI Module và Sơ đồ quan hệ SVG.
 */

import { db, ref, set, get, update, push } from "./firebase-config.js";

// ==========================================
// 1. TRẠNG THÁI TOÀN CỤC CỤC BỘ (GLOBAL GAME STATE)
// ==========================================
window.G = {
    lang: 'vi',
    players: [],
    day: 0,
    phase: 'setup',
    mayorId: null,
    clownWon: false,
    gameMode: 'custom',
    loneWolfDayLimit: 3,
    roleCounts: {},
    roleSearchKeyword: "",
    currentRolePage: 0,
    rolesPerPage: 5,
    gameTimeline: [],
    playerStats: {}
};

// ==========================================
// 2. PHÂN LOẠI VAI TRÒ TOÀN DIỆN (ROLE CLASSIFICATIONS)
// ==========================================
export const PASSIVE_ROLES = [
    "villager", "clown", "idiot", "ghost", "halfWolf", "apprenticeSeer", 
    "doppelganger", "lostChild", "headlessKnight", "paradox", "fugitive", 
    "cryptoMiner", "reverser", "glitch", "sovereign", "ember", "traitor", 
    "blackDeath", "loneWolf", "chaosWolf", "bloodline", "ashenKnight"
];

export const ACTIVE_NIGHT_ROLES = [
    "seer", "guard", "witch", "hunter", "cupid", "avenger", "carver", 
    "guarantor", "reflector", "thief", "police", "spy", "angel", 
    "demonologist", "parrot", "wolf", "wolfBoss", "wolfSnow", "wolfMage", 
    "phantomWolf", "clairvoyantWolf", "mirrorWolf", "resonanceWolf", 
    "silencerWolf", "solitaireWolf", "demonDetective", "missionary", 
    "vampire", "arsonist", "eradicator", "manipulator", "impostor", 
    "bountyHunter", "shark", "apprenticeReaper", "serialKiller", 
    "prime", "cat", "reaper"
];

export const ON_DEATH_ROLES = [
    "hunter", "cat", "avenger", "blackDeath", "paradox", "clown", "headlessKnight"
];

export const SOLO_WIN_ROLES = [
    "clown", "arsonist", "serialKiller", "vampire", "reaper", "prime", "ashenKnight", "loneWolf"
];

// ==========================================
// 3. TỪ ĐIỂN ĐA NGÔN NGỮ HOÀN CHỈNH 100% (I18N DICTIONARY)
// ==========================================
export const DICT = {
    vi: {
        tab1: "Bàn Chơi", tab2: "Cấu Hình Role", tab3: "Điều Khiển", tab4: "Mật Thư", tab5: "Thảo Luận",
        btn_back: "⬅️ Quay lại",
        t_players: "👥 THẦN DÂN KẾT NỐI", t_add_ph: "Nhập tên...", t_add_btn: "Thêm",
        t_role_config: "⚙️ THIẾT LẬP VAI TRÒ", t_btn_dist: "🎲 Trộn & Phát Role", t_search_role: "Tìm kiếm vai trò...", t_active_roles: "Vai trò sử dụng: ",
        t_preset_title: "CHẾ ĐỘ CHƠI MẪU:", t_mode_classic: "Kinh Điển (Classic)", t_mode_lonewolf: "Vũ Điệu Cô Độc", t_mode_chaos: "Hỗn Mang Đêm Đen", t_mode_vampire: "Huyết Tộc Trỗi Dậy",
        t_balance_meter: "CÁN CÂN TRẬN ĐẤU:", balance_wolf: "🐺 Sói Áp Đảo (Game Nhanh)", balance_village: "🌾 Dân Làng Thắng Thế", balance_third: "🧛 Phe Thứ 3 Nguy Hiểm", balance_neutral: "⚖️ Cân Bằng Hoàn Hảo",
        t_board: "🎮 BÀN ĐIỀU KHIỂN TỐI CAO", t_setup_phase: "ĐANG THIẾT LẬP", t_mayor: "Trưởng Làng:", t_no_mayor: "Chưa có", t_start_game: "🚀 BẮT ĐẦU VÁN ĐẤU", t_setup_guide: "Đang chờ Quản trò chọn vai trò...",
        t_secrets: "🕵️ BÍ MẬT & PHE PHÁI", t_villagers: "🌾 DÂN LÀNG", t_wolves: "🐺 MA SÓI", t_thirds: "🧛 PHE THỨ 3", t_empty: "<i>Trống</i>",
        t_log: "📜 LỊCH SỬ DIỄN BIẾN", t_settings: "⚙️ CÀI ĐẶT HỆ THỐNG", t_close: "Đóng", t_theme: "🎨 GIAO DIỆN MÀU SẮC", t_time: "⏱️ THỜI GIAN BAN NGÀY", t_lang: "🌐 NGÔN NGỮ",
        t_mailbox: "⚙️ HÒM MẬT THƯ",

        // Tên 61 Vai Trò (VI)
        r_villager: 'Dân Làng', r_seer: 'Tiên Tri', r_guard: 'Bảo Vệ', r_witch: 'Phù Thủy', r_hunter: 'Thợ Săn', r_cupid: 'Cupid', r_halfWolf: 'Bán Sói', r_headlessKnight: 'Hiệp Sĩ Không Đầu', r_apprenticeSeer: 'Tiên Tri Tập Sự', r_ghost: 'Con Ma', r_doppelganger: 'Song Trùng', r_avenger: 'Kẻ Báo Thù', r_paradox: 'Kẻ Nghịch Hành', r_lostChild: 'Đứa Con Thất Lạc', r_carver: 'Kẻ Khắc Tên', r_guarantor: 'Người Bảo Lãnh', r_reflector: 'Kẻ Phản Chiếu', r_thief: 'Tên Trộm', r_fugitive: 'Kẻ Đào Tẩu', r_cryptoMiner: 'Kẻ Đào Coin', r_reverser: 'Người Đảo Ngược', r_glitch: 'Bản Sao Lỗi', r_police: 'Cảnh Sát Trưởng', r_spy: 'Gián Điệp', r_angel: 'Thiên Sứ', r_sovereign: 'Kẻ Độc Tôn', r_demonologist: 'Nhà Ngoại Cảm', r_parrot: 'Vẹt', r_ember: 'Kẻ Độc Hành', r_idiot: 'Kẻ Ngốc',
        r_wolf: 'Ma Sói', r_wolfBoss: 'Sói Trùm', r_wolfSnow: 'Sói Tuyết', r_wolfMage: 'Pháp Sư Sói', r_traitor: 'Kẻ Phản Bội', r_blackDeath: 'Cái Chết Đen', r_phantomWolf: 'Sói Ảo Ảnh', r_clairvoyantWolf: 'Sói Thấu Thị', r_mirrorWolf: 'Sói Gương', r_resonanceWolf: 'Sói Cộng Hưởng', r_silencerWolf: 'Sói Câm Lặng', r_loneWolf: 'Sói Cô Độc', r_solitaireWolf: 'Sói Tarot', r_chaosWolf: 'Sói Hỗn Mang', r_bloodline: 'Sói Già',
        r_demonDetective: 'Thám Tử Ác Ma', r_missionary: 'Nhà Truyền Giáo', r_vampire: 'Ma Cà Rồng', r_arsonist: 'Kẻ Phóng Hỏa', r_eradicator: 'Kẻ Thanh Trừng', r_clown: 'Gã Hề', r_manipulator: 'Kẻ Thao Túng', r_impostor: 'Kẻ Mạo Danh', r_bountyHunter: 'Thợ Săn Tiền Thưởng', r_shark: 'Cá Mập Tài Chính', r_apprenticeReaper: 'Thần Chết Tập Sự', r_serialKiller: 'Sát Nhân', r_prime: 'Chủ Thần', r_ashenKnight: 'Kỵ Sĩ Tro Tàn', r_cat: 'Mèo', r_reaper: 'Tử Thần',

        // Mô tả Chi Tiết 61 Vai Trò (VI)
        desc_villager: "Thần dân bình thường không có kỹ năng ban đêm. Dùng lời nói và logic để tìm ra Ma Sói ban ngày.",
        desc_seer: "Mỗi đêm được chọn 1 người chơi để soi kiểm tra Phe Phái thực sự hoặc Vai Trò chính xác.",
        desc_guard: "Mỗi đêm chọn 1 người chơi để bảo vệ khỏi bị tấn công tử vong (Không được bảo vệ 1 người 2 đêm liên tiếp).",
        desc_witch: "Sở hữu 1 bình Dược Thủy cứu sống nạn nhân bị cắn và 1 bình Độc Dược hạ sát mục tiêu. Dùng 1 lần duy nhất.",
        desc_hunter: "Khi bị cắn chết hoặc bị treo cổ ban ngày, được nổ súng bắn kéo theo 1 mục tiêu xuống mồ.",
        desc_cupid: "Đêm đầu tiên se duyên tơ hồng cho 2 người chơi. Nếu 1 trong 2 người chết, người còn lại sẽ tự sát chết theo.",
        desc_halfWolf: "Đầu game là Dân Làng. Nếu bị Ma Sói cắn hoặc Vampire cắn sẽ chuyển hóa thành Ma Sói chính thức.",
        desc_headlessKnight: "Được miễn nhiễm hoàn toàn với mọi đòn tấn công tử vong vào đêm đầu tiên.",
        desc_apprenticeSeer: "Trở thành Tiên Tri chính thức nếu Tiên Tri tiền nhiệm ngã xuống tử vong.",
        desc_ghost: "Bị hy sinh vào đêm đầu tiên và theo dõi diễn biến trận đấu dưới dạng linh hồn.",
        desc_doppelganger: "Đêm 1 chọn 1 người làm mục tiêu. Khi mục tiêu đó tử vong, bạn lập tức kế thừa vai trò của họ.",
        desc_avenger: "Chọn 1 mục tiêu ban đêm để gây mê phong ấn kỹ năng hoặc trừng phạt sát thương tử vong.",
        desc_paradox: "Nếu bị treo cổ ban ngày, sẽ kéo ngược thời gian đảo ngược kết quả biểu quyết.",
        desc_lostChild: "Chờ đợi sự thức tỉnh phe phái từ hành động của Quản trò.",
        desc_carver: "Đánh dấu khắc tên kẻ thù. Nếu kẻ đó bị treo cổ ban ngày, bạn nhận sức mạnh tối cao.",
        desc_guarantor: "Đứng ra bảo lãnh 1 người chơi khỏi đài biện hộ treo cổ.",
        desc_reflector: "Dựng kính ma thuật dội ngược toàn bộ kỹ năng đêm hướng về chính kẻ thi triển.",
        desc_thief: "Đêm đầu tiên được chọn hoán đổi vai trò bí mật với 1 người chơi khác.",
        desc_fugitive: "Được miễn nhiễm bị bỏ phiếu treo cổ trong 1 lượt ban ngày.",
        desc_cryptoMiner: "Tích lũy tài nguyên qua từng đêm để mở khóa đặc quyền bảo vệ.",
        desc_reverser: "Đảo ngược tác động kỹ năng của 1 mục tiêu ban đêm.",
        desc_glitch: "Tạo nhiễu loạn thông tin khiến Tiên Tri soi sai kết quả.",
        desc_police: "Kiểm tra xem mục tiêu có nắm giữ vũ khí sát thương hay không.",
        desc_spy: "Thám báo lén xem tin nhắn thảo luận nội bộ ban đêm của bầy Ma Sói.",
        desc_angel: "Tịnh hóa gột rửa toàn bộ bùa chú câm lặng, phong ấn hay dầu dội khỏi 1 người chơi.",
        desc_sovereign: "Sở hữu lá phiếu Trưởng Làng có trọng số gấp 3 lần bình thường.",
        desc_demonologist: "Cảm nhận được số lượng Ma Sói còn sống trong làng.",
        desc_parrot: "Ép buộc mục tiêu phải phát ngôn đúng câu lệnh được giao vào buổi sáng.",
        desc_ember: "Nhận khiên bảo vệ nếu là người duy nhất không dùng kỹ năng.",
        desc_idiot: "Nếu bị làng bỏ phiếu treo cổ, sẽ lật thẻ chứng minh bị Khùng và không bị chết, nhưng mất quyền bỏ phiếu.",
        desc_wolf: "Cùng bầy Sói thảo luận vào kênh chat riêng và chốt hạ 1 nạn nhân bị cắn chết mỗi đêm.",
        desc_wolfBoss: "Sói Trùm nắm quyền quyết định tối cao nếu bầy Sói không thống nhất được mục tiêu cắn.",
        desc_wolfSnow: "Đóng băng cứng 1 người chơi, khiến họ không thể kích hoạt kỹ năng đêm.",
        desc_wolfMage: "Dùng ma pháp soi tìm chính xác ai là Tiên Tri trong vương quốc.",
        desc_traitor: "Ban ngày là Dân Làng, khi toàn bộ Sói chết sẽ thức tỉnh thành Sói Trùm.",
        desc_blackDeath: "Khi chết sẽ gieo rắc mầm bệnh khiến kẻ cắn mình dính độc.",
        desc_phantomWolf: "Tráo đổi nhân dạng và vị trí ảo ảnh giữa 2 người chơi ban đêm.",
        desc_clairvoyantWolf: "Nhìn thấy danh sách những người bị Tiên Tri soi đêm qua.",
        desc_mirrorWolf: "Phản chiếu lại đòn tấn công về kẻ đã nhắm vào mình.",
        desc_resonanceWolf: "Tăng sức mạnh đòn cắn khi bầy Sói đồng lòng chốt 1 mục tiêu.",
        desc_silencerWolf: "Khóa miệng 1 người chơi ban đêm, khiến họ không thể gõ chat thảo luận sáng hôm sau.",
        desc_loneWolf: "Thuộc phe Sói nhưng phải là kẻ duy nhất sống sót cuối cùng để thắng Đơn Lập.",
        desc_solitaireWolf: "Rút lá bài Tarot định đoạt số phận nạn nhân đêm nay.",
        desc_chaosWolf: "Gây rối loạn mục tiêu tấn công của bầy Sói theo tỷ lệ ngẫu nhiên.",
        desc_bloodline: "Cắn truyền huyết thống Ma Sói cho nạn nhân thay vì hạ sát.",
        desc_demonDetective: "Thám tử bóng đêm điều tra hành vi ma thuật của thần dân.",
        desc_missionary: "Thu phục các thành viên quy thuận gia nhập giáo phái của mình.",
        desc_vampire: "Truyền vết cắn Huyết Tộc, mở kênh chat Vampire và biến đổi nạn nhân.",
        desc_arsonist: "Tẩm xăng các căn nhà ban đêm và châm lửa thiêu rụi toàn bộ mục tiêu bị dội dầu.",
        desc_eradicator: "Đặt bẫy sắt phòng thủ. Kẻ nào tác động kỹ năng vào sẽ dính bẫy tử vong.",
        desc_clown: "Mục tiêu duy nhất là dụ Dân Làng treo cổ mình trên đài biện hộ để thắng đơn lập!",
        desc_manipulator: "Bẻ hướng kỹ năng đêm của mục tiêu A dội sang mục tiêu B.",
        desc_impostor: "Mạo danh thi triển nhát chém chí mạng ban đêm.",
        desc_bountyHunter: "Săn tiền thưởng bằng cách tiêu diệt đúng mục tiêu được giao.",
        desc_shark: "Cá mập tài chính chi phối phiếu bầu bằng quyền lực tiền tệ.",
        desc_apprenticeReaper: "Kế thừa chiếc lưỡi hái Tử Thần khi Tử Thần cũ tử vong.",
        desc_serialKiller: "Sát nhân cuồng loạn hạ sát 1 mục tiêu mỗi đêm, xuyên qua lá chắn Bảo Vệ.",
        desc_prime: "Chủ Thần lập Khế Ước che chở cho 2 thân cận ban đêm và mở kênh chat riêng.",
        desc_ashenKnight: "Kỵ sĩ tro tàn tích lũy sức mạnh từ các linh hồn đã hy sinh.",
        desc_cat: "Mèo thần thoại. Có thể cào xé mục tiêu hoặc phong ấn kỹ năng. Khi chết kéo kẻ sát hại chết theo.",
        desc_reaper: "Dự đoán linh hồn tử vong đêm nay để tích lũy quyền năng thu hoạch linh hồn.",

        alert_btn: "Đã Hiểu",
        msg_need_3: "Cần tối thiểu 3 người chơi kết nối trực tuyến!",
        msg_game_start: "🚀 CHÀO MỪNG ĐẾN VỚI WOLFPACK SOVEREIGN!",
        phase_night: "Đêm {0}", phase_day: "Ngày {0}",
        ui_dead_count: "Đêm qua ghi nhận {0} người chết", ui_dead_names: "Danh sách tử vong: {0}"
    },
    en: {
        tab1: "Board", tab2: "Role Setup", tab3: "Controls", tab4: "Secrets", tab5: "Chat",
        btn_back: "⬅️ Back",
        t_players: "👥 CONNECTED PLAYERS", t_add_ph: "Enter name...", t_add_btn: "Add",
        t_role_config: "⚙️ ROLE CONFIGURATION", t_btn_dist: "🎲 Shuffle & Distribute", t_search_role: "Search roles...", t_active_roles: "Active roles: ",
        t_preset_title: "GAME MODE PRESETS:", t_mode_classic: "Classic Mode", t_mode_lonewolf: "A Waltz Among Wolves", t_mode_chaos: "Chaos Realm", t_mode_vampire: "Vampire Invasion",
        t_balance_meter: "BALANCE METER:", balance_wolf: "🐺 Wolf-Favored", balance_village: "🌾 Village-Favored", balance_third: "🧛 3rd Party Dominant", balance_neutral: "⚖️ Perfectly Balanced",
        t_board: "🎮 MASTER BOARD", t_setup_phase: "GAME SETUP", t_mayor: "Mayor:", t_no_mayor: "None", t_start_game: "🚀 START MATCH", t_setup_guide: "Waiting for host to configure roles...",
        t_secrets: "🕵️ SECRETS & FACTIONS", t_villagers: "🌾 VILLAGERS", t_wolves: "🐺 WEREWOLVES", t_thirds: "🧛 3RD PARTY", t_empty: "<i>Empty</i>",
        t_log: "📜 EVENT LOG", t_settings: "⚙️ SYSTEM SETTINGS", t_close: "Close", t_theme: "🎨 UI THEME", t_time: "⏱️ DAY DISCUSSION TIME", t_lang: "🌐 LANGUAGE",
        t_mailbox: "⚙️ MAILBOX",

        // Tên 61 Vai Trò (EN)
        r_villager: 'Villager', r_seer: 'Seer', r_guard: 'Guard', r_witch: 'Witch', r_hunter: 'Hunter', r_cupid: 'Cupid', r_halfWolf: 'Half Wolf', r_headlessKnight: 'Headless Knight', r_apprenticeSeer: 'Apprentice Seer', r_ghost: 'Ghost', r_doppelganger: 'Doppelganger', r_avenger: 'The Avenger', r_paradox: 'The Paradox', r_lostChild: 'The Lost Child', r_carver: 'The Carver', r_guarantor: 'The Guarantor', r_reflector: 'The Reflector', r_thief: 'Thief', r_fugitive: 'Fugitive', r_cryptoMiner: 'Crypto Miner', r_reverser: 'The Reverser', r_glitch: 'The Glitch', r_police: 'Sheriff', r_spy: 'Spy', r_angel: 'Angel', r_sovereign: 'The Sovereign', r_demonologist: 'Demonologist', r_parrot: 'Parrot', r_ember: 'The Soloist', r_idiot: 'Fool',
        r_wolf: 'Werewolf', r_wolfBoss: 'Wolf Boss', r_wolfSnow: 'Snow Wolf', r_wolfMage: 'Wolf Mage', r_traitor: 'Traitor', r_blackDeath: 'Black Death', r_phantomWolf: 'Phantom Wolf', r_clairvoyantWolf: 'Clairvoyant Wolf', r_mirrorWolf: 'Mirror Wolf', r_resonanceWolf: 'Resonance Wolf', r_silencerWolf: 'Silencer Wolf', r_loneWolf: 'Lone Wolf', r_solitaireWolf: 'Solitaire Wolf', r_chaosWolf: 'Chaos Wolf', r_bloodline: 'Elder Wolf',
        r_demonDetective: 'Demon Detective', r_missionary: 'Missionary', r_vampire: 'Vampire', r_arsonist: 'Arsonist', r_eradicator: 'Eradicator', r_clown: 'Clown', r_manipulator: 'The Manipulator', r_impostor: 'The Impostor', r_bountyHunter: 'Bounty Hunter', r_shark: 'Financial Shark', r_apprenticeReaper: 'Apprentice Reaper', r_serialKiller: 'Serial Killer', r_prime: 'The Prime', r_ashenKnight: 'Ashen Knight', r_cat: 'Cat', r_reaper: 'The Reaper',

        // Mô tả Chi Tiết 61 Vai Trò (EN)
        desc_villager: "Normal villager with no special night abilities. Use logic and discussion to find Werewolves.",
        desc_seer: "Check one player every night to reveal their true Faction or exact Role.",
        desc_guard: "Protect one player every night from kill attacks (Cannot protect the same target twice in a row).",
        desc_witch: "Has one Healing potion to save a victim and one Poison potion to kill a target. Single use each.",
        desc_hunter: "If killed at night or lynched by day vote, can fire a final bullet to take down any target.",
        desc_cupid: "Binds two players in love on night 1. If one dies, the other commits suicide immediately.",
        desc_halfWolf: "Starts as a Villager. Transforms into a full Werewolf if bitten by Wolves or Vampires.",
        desc_headlessKnight: "Completely immune to all lethal night attacks on Night 1.",
        desc_apprenticeSeer: "Becomes the official Seer if the original Seer perishes.",
        desc_ghost: "Eliminated on Night 1 and observes the game as a spectral entity.",
        desc_doppelganger: "Selects a target on Night 1. Inherits their exact role upon their death.",
        desc_avenger: "Selects a target to either block their night skills or inflict lethal punishment.",
        desc_paradox: "If lynched by day vote, rewinds time to reverse the trial decision.",
        desc_lostChild: "Awaits alignment awakening triggered by GM actions.",
        desc_carver: "Marks an enemy name. If that target is lynched by day, gains ultimate power.",
        desc_guarantor: "Guarantees immunity for a target from the trial defense stand.",
        desc_reflector: "Erects a magic mirror reflecting all night actions back to the casters.",
        desc_thief: "Swaps roles secretly with another player on Night 1.",
        desc_fugitive: "Gains immunity from day lynch voting for 1 round.",
        desc_cryptoMiner: "Accumulates resources each night to unlock protection perks.",
        desc_reverser: "Reverses the skill effect direction of a night target.",
        desc_glitch: "Distorts night magic, causing the Seer to inspect false information.",
        desc_police: "Checks whether a target carries lethal attack weapons.",
        desc_spy: "Eavesdrops on the internal night chat messages of the Werewolf pack.",
        desc_angel: "Purifies a player, cleansing all mute curses, seals, or petrol oil.",
        desc_sovereign: "Holds Mayor votes worth triple weight during day voting.",
        desc_demonologist: "Senses the remaining count of living Werewolves in the village.",
        desc_parrot: "Forces the target to repeat a dictated message in public chat the next morning.",
        desc_ember: "Gains a protective shield if they are the only player who refrains from using skills.",
        desc_idiot: "If voted to be lynched, reveals their identity card to avoid death, but loses voting rights.",
        desc_wolf: "Discusses in secret pack chat and targets one victim to kill each night.",
        desc_wolfBoss: "Wolf Boss holds ultimate veto authority if the pack disagrees on a kill target.",
        desc_wolfSnow: "Freezes a player solid, preventing them from using night abilities.",
        desc_wolfMage: "Uses dark magic to pinpoint the exact player holding the Seer role.",
        desc_traitor: "Appears as a Villager by day; awakens as the Wolf Boss when all Wolves die.",
        desc_blackDeath: "Spreads plague upon death, poisoning anyone who attacks them.",
        desc_phantomWolf: "Swaps phantom identities and visual positions between 2 players at night.",
        desc_clairvoyantWolf: "Sees the list of targets scanned by the Seer on the previous night.",
        desc_mirrorWolf: "Reflects incoming night attacks back at the attacker.",
        desc_resonanceWolf: "Amplifies kill damage when the pack unanimously agrees on a single target.",
        desc_silencerWolf: "Silences a player at night, preventing them from sending chat messages the next morning.",
        desc_loneWolf: "Belongs to the Wolf faction but must be the sole survivor to win Solo.",
        desc_solitaireWolf: "Draws Tarot cards to dictate the fate of tonight's victim.",
        desc_chaosWolf: "Disrupts the pack's attack targeting randomly with chaotic magic.",
        desc_bloodline: "Bites to infect and convert the victim into a Werewolf instead of killing.",
        desc_demonDetective: "Investigates dark magic signatures and actions among players.",
        desc_missionary: "Converts players to join their holy church cult.",
        desc_vampire: "Bites to infect, unlocking Vampire chat and converting victims.",
        desc_arsonist: "Douses houses in petrol at night and ignites them to incinerate all oiled targets.",
        desc_eradicator: "Sets steel defense traps. Anyone targeting them springs the fatal trap.",
        desc_clown: "Your sole goal is to trick the village into lynching you on the trial stage to win solo!",
        desc_manipulator: "Redirects night skill effects from Target A to Target B.",
        desc_impostor: "Disguises as another role to deliver lethal night slashes.",
        desc_bountyHunter: "Hunts assigned targets to collect bounties and secure victory.",
        desc_shark: "Financial shark controlling votes through monetary influence.",
        desc_apprenticeReaper: "Inherits the Grim Reaper scythe upon the original Reaper's death.",
        desc_serialKiller: "Maniacal killer taking 1 life every night, penetrating Guard shields.",
        desc_prime: "Establishes a Covenant protecting 2 followers at night with a private chat.",
        desc_ashenKnight: "Ashen knight gaining power from fallen souls.",
        desc_cat: "Mythical Cat. Can claw victims or seal skills. Takes down their killer upon death.",
        desc_reaper: "Predicts soul deaths tonight to reap power and claim victory.",

        alert_btn: "Got it",
        msg_need_3: "Need at least 3 players connected online!",
        msg_game_start: "🚀 WELCOME TO WOLFPACK SOVEREIGN!",
        phase_night: "Night {0}", phase_day: "Day {0}",
        ui_dead_count: "{0} players died last night", ui_dead_names: "Victims: {0}"
    }
};

// ==========================================
// 4. BẢNG MÃ PHE PHÁI BẢN QUYỀN (FACTIONS DATABASE)
// ==========================================
export const ROLE_DB = {
    // Phe Dân Làng (30)
    villager: { faction: 'villager', powerRating: 1 }, seer: { faction: 'villager', powerRating: 4 }, guard: { faction: 'villager', powerRating: 3 }, witch: { faction: 'villager', powerRating: 5 }, hunter: { faction: 'villager', powerRating: 3 }, cupid: { faction: 'villager', powerRating: 3 }, halfWolf: { faction: 'villager', powerRating: 2 }, headlessKnight: { faction: 'villager', powerRating: 2 }, apprenticeSeer: { faction: 'villager', powerRating: 2 }, ghost: { faction: 'villager', powerRating: 1 }, doppelganger: { faction: 'villager', powerRating: 3 }, avenger: { faction: 'villager', powerRating: 4 }, paradox: { faction: 'villager', powerRating: 2 }, lostChild: { faction: 'villager', powerRating: 1 }, carver: { faction: 'villager', powerRating: 3 }, guarantor: { faction: 'villager', powerRating: 3 }, reflector: { faction: 'villager', powerRating: 4 }, thief: { faction: 'villager', powerRating: 3 }, fugitive: { faction: 'villager', powerRating: 2 }, cryptoMiner: { faction: 'villager', powerRating: 1 }, reverser: { faction: 'villager', powerRating: 3 }, glitch: { faction: 'villager', powerRating: 2 }, police: { faction: 'villager', powerRating: 3 }, spy: { faction: 'villager', powerRating: 3 }, angel: { faction: 'villager', powerRating: 4 }, sovereign: { faction: 'villager', powerRating: 4 }, demonologist: { faction: 'villager', powerRating: 3 }, parrot: { faction: 'villager', powerRating: 2 }, ember: { faction: 'villager', powerRating: 2 }, idiot: { faction: 'villager', powerRating: 1 },

    // Phe Ma Sói (15)
    wolf: { faction: 'wolf', powerRating: 3 }, wolfBoss: { faction: 'wolf', powerRating: 5 }, wolfSnow: { faction: 'wolf', powerRating: 4 }, wolfMage: { faction: 'wolf', powerRating: 4 }, traitor: { faction: 'wolf', powerRating: 2 }, blackDeath: { faction: 'wolf', powerRating: 4 }, phantomWolf: { faction: 'wolf', powerRating: 4 }, clairvoyantWolf: { faction: 'wolf', powerRating: 4 }, mirrorWolf: { faction: 'wolf', powerRating: 3 }, resonanceWolf: { faction: 'wolf', powerRating: 3 }, silencerWolf: { faction: 'wolf', powerRating: 4 }, loneWolf: { faction: 'wolf', powerRating: 5 }, solitaireWolf: { faction: 'wolf', powerRating: 3 }, chaosWolf: { faction: 'wolf', powerRating: 4 }, bloodline: { faction: 'wolf', powerRating: 4 },

    // Phe Thứ Ba & Đơn Lập (16)
    demonDetective: { faction: 'third', powerRating: 4 }, missionary: { faction: 'third', powerRating: 4 }, vampire: { faction: 'third', powerRating: 5 }, arsonist: { faction: 'third', powerRating: 5 }, eradicator: { faction: 'third', powerRating: 4 }, clown: { faction: 'third', powerRating: 3 }, manipulator: { faction: 'third', powerRating: 4 }, impostor: { faction: 'third', powerRating: 4 }, bountyHunter: { faction: 'third', powerRating: 3 }, shark: { faction: 'third', powerRating: 3 }, apprenticeReaper: { faction: 'third', powerRating: 3 }, serialKiller: { faction: 'third', powerRating: 5 }, prime: { faction: 'third', powerRating: 5 }, ashenKnight: { faction: 'third', powerRating: 4 }, cat: { faction: 'third', powerRating: 3 }, reaper: { faction: 'third', powerRating: 5 }
};

export const ROLE_ICONS = {
    villager: '🌾', seer: '🔮', guard: '🛡️', witch: '🧪', hunter: '🏹', cupid: '💘', halfWolf: '🐺', headlessKnight: '🎃', apprenticeSeer: '👁️', ghost: '👻', thief: '🦹', doppelganger: '🎭', avenger: '⚔️', paradox: '⏳', lostChild: '👶', carver: '🔪', guarantor: '🤝', reflector: '🪞', fugitive: '🏃', cryptoMiner: '⛏️', reverser: '🔄', glitch: '👾', police: '🔫', spy: '🕵️', angel: '👼', sovereign: '👑', demonologist: '🧿', parrot: '🦜', ember: '🔥', idiot: '🤡',
    wolf: '🐺', wolfBoss: '👑', wolfSnow: '❄️', wolfMage: '👁️‍🗨️', traitor: '🕵️', blackDeath: '🦠', phantomWolf: '🎭', clairvoyantWolf: '👁', mirrorWolf: '🪞', resonanceWolf: '🐺', silencerWolf: '🤫', loneWolf: '🐺', solitaireWolf: '🃏', chaosWolf: '🌪️', bloodline: '🩸',
    demonDetective: '🦇', missionary: '🕍', vampire: '🧛', arsonist: '🔥', eradicator: '⚔️', clown: '🤡', manipulator: '🪄', impostor: '🥸', bountyHunter: '🎯', shark: '🦈', apprenticeReaper: '🪦', serialKiller: '🔪', prime: '👑', ashenKnight: '⚔️', cat: '🐈', reaper: '💀'
};

export const FACTION_ICONS = { villager: '🌾', wolf: '🐺', third: '🧛' };

// ==========================================
// 5. CÁC HÀM TRUY XUẤT TÊN VÀ MÔ TẢ THEO NGÔN NGỮ
// ==========================================
export const getRoleName = (key) => DICT[window.G.lang || 'vi']['r_' + key] || key;
export const getRoleDesc = (key) => DICT[window.G.lang || 'vi']['desc_' + key] || "Chưa có mô tả chi tiết cho vai trò này.";
export const getRoleFaction = (key) => ROLE_DB[key] ? ROLE_DB[key].faction : 'villager';
export const getRoleIcon = (key) => ROLE_ICONS[key] || '🔮';

export const t = (key, ...args) => {
    let text = DICT[window.G.lang || 'vi'][key] || key;
    args.forEach((arg, i) => { text = text.replace(`{${i}}`, arg); });
    return text;
};

window.getRoleName = getRoleName;
window.getRoleDesc = getRoleDesc;
window.getRoleFaction = getRoleFaction;
window.getRoleIcon = getRoleIcon;
window.t = t;

// ==========================================
// 6. BỘ ĐIỀU HÀNH THAO TÁC ENGINE (ENGINE MODULE)
// ==========================================
export const Engine_Module = {
    distributeRoles: async () => {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        
        const activePlayers = Object.values(Net.players).filter(p => p.isConnected);
        const playerCount = activePlayers.length;

        if (playerCount < 3) {
            window.alert(t('msg_need_3'));
            return;
        }

        let configuredRoleCount = 0;
        const currentCounts = window.G.roleCounts || {};
        for (let key in currentCounts) {
            configuredRoleCount += currentCounts[key] || 0;
        }

        if (configuredRoleCount !== playerCount) {
            const difference = playerCount - configuredRoleCount;
            if (difference > 0) {
                window.alert(`Số lượng vai trò chưa đủ! Cần thêm ${difference} vai trò nữa để vừa khớp với ${playerCount} người chơi.`);
            } else {
                window.alert(`Số lượng vai trò bị thừa! Cần giảm ${Math.abs(difference)} vai trò để vừa khớp với ${playerCount} người chơi.`);
            }
            return;
        }

        let rolePool = [];
        for (let key in ROLE_DB) {
            let count = currentCounts[key] || 0;
            for (let i = 0; i < count; i++) {
                rolePool.push(key);
            }
        }

        // Trộn bài ngẫu nhiên (Fisher-Yates Shuffle)
        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        const updates = {};
        activePlayers.forEach((p, idx) => {
            const assignedRole = rolePool[idx];
            const isPassiveRole = PASSIVE_ROLES.includes(assignedRole);

            updates[`rooms/${Net.roomId}/players/${p.id}/role`] = assignedRole;
            updates[`rooms/${Net.roomId}/players/${p.id}/realFaction`] = ROLE_DB[assignedRole].faction;
            updates[`rooms/${Net.roomId}/players/${p.id}/turnEnded`] = isPassiveRole; 
            updates[`rooms/${Net.roomId}/players/${p.id}/hasSeenRole`] = false; 
            updates[`rooms/${Net.roomId}/players/${p.id}/alive`] = true;
        });

        try {
            await update(ref(db), updates);
            window.alert("Trộn và phân phát vai trò hoàn tất! GM có thể bấm BẮT ĐẦU ĐÊM ĐEN.");
            document.getElementById("btn-gm-start-night")?.classList.remove("hidden");
        } catch (error) {
            console.error("Lỗi đồng bộ phân phát role:", error);
            window.alert("Đã xảy ra lỗi đồng bộ hóa khi phát vai trò!");
        }
    },

    startGame: async () => {
        const Net = window.Net;
        if (!Net || !Net.isHost) return;

        const updates = {
            [`rooms/${Net.roomId}/meta/started`]: true,
            [`rooms/${Net.roomId}/meta/day`]: 1,
            [`rooms/${Net.roomId}/meta/phase`]: "night"
        };

        try {
            await update(ref(db), updates);
            Engine_Module.logMsg(t('msg_game_start'), "info");
        } catch (error) {
            window.alert("Không thể phát lệnh khởi tạo trận đấu!");
        }
    },

    logMsg: async (msg, type = "sys") => {
        const Net = window.Net;
        if (!Net || !Net.roomId) return;
        
        const logRef = ref(db, `rooms/${Net.roomId}/logs`);
        const logItem = {
            day: window.G.day || 0,
            phase: window.G.phase || "setup",
            msg: msg,
            type: type,
            timestamp: Date.now()
        };
        try {
            await push(logRef, logItem);
        } catch (error) {
            console.error("Lỗi khi ghi lịch sử ván đấu:", error);
        }
    },

    accusePlayer: async (targetId) => {
        const Net = window.Net;
        if (!Net) return;
        
        const selfId = Net.playerId;
        const currentNomRef = ref(db, `rooms/${Net.roomId}/nominations/${selfId}`);
        try {
            const snapshot = await get(currentNomRef);
            if (snapshot.exists() && snapshot.val() === targetId) {
                await set(currentNomRef, null);
                Engine_Module.logMsg(`${Net.playerName} đã rút lại đề cử treo cổ.`, "sys");
            } else {
                await set(currentNomRef, targetId);
                Engine_Module.logMsg(`${Net.playerName} tố cáo và đề nghị đưa [${Net.players[targetId]?.name}] lên đài biện hộ!`, "sys");
            }
        } catch (error) {
            console.error(error);
        }
    }
};

// Kiểm tra đa số phiếu đề cử treo cổ (Dành cho máy Host)
export async function checkMajorityNominationTrigger() {
    const Net = window.Net;
    if (!Net || !Net.isHost) return; 
    
    const nomRef = ref(db, `rooms/${Net.roomId}/nominations`);
    try {
        const snap = await get(nomRef);
        const nominations = snap.val() || {};
        const aliveCount = window.G.players.filter(p => p.alive).length;
        const majorityThreshold = Math.floor(aliveCount / 2) + 1;

        const counts = {};
        Object.values(nominations).forEach(targetId => {
            if (targetId) {
                counts[targetId] = (counts[targetId] || 0) + 1;
            }
        });

        for (let [targetId, votes] of Object.entries(counts)) {
            if (votes >= majorityThreshold) {
                const trialUpdates = {
                    [`rooms/${Net.roomId}/trial`]: {
                        stage: "defense",
                        accusedId: targetId,
                        accusedText: ""
                    },
                    [`rooms/${Net.roomId}/nominations`]: null 
                };
                await update(ref(db), trialUpdates);
                Engine_Module.logMsg(`⚖️ [${Net.players[targetId]?.name}] đã nhận quá bán phiếu tố cáo (${votes}/${aliveCount})! Bắt đầu thời gian biện hộ.`, "info");
                break;
            }
        }
    } catch (err) {
        console.error("Lỗi quét biểu quyết quá bán:", err);
    }
}

window.checkMajorityNominationTrigger = checkMajorityNominationTrigger;

// ==========================================
// 7. HIỂN THỊ GIAO DIỆN VÀ PHÂN TRANG (UI MODULE)
// ==========================================
export const UI_Module = {
    switchTab: (idx) => {
        document.body.setAttribute("data-mobile-tab", idx);
        const tabs = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
        tabs.forEach((tabId, i) => {
            const el = document.getElementById(tabId);
            if (el) {
                if (i + 1 === idx) el.classList.add("active");
                else el.classList.remove("active");
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
        const Net = window.Net;
        if (!Net || !Net.isHost) return;
        
        const currentQty = window.G.roleCounts[key] || 0;
        const newQty = Math.max(0, currentQty + delta);
        
        update(ref(db, `rooms/${Net.roomId}/roleCounts`), {
            [key]: newQty
        });
    },

    executeDeath: async (playerId) => {
        const Net = window.Net;
        if (!Net) return;

        const playerRef = ref(db, `rooms/${Net.roomId}/players/${playerId}`);
        try {
            await update(playerRef, { alive: false });
            Engine_Module.logMsg(`💀 Đối tượng [${window.G.players.find(p=>p.id===playerId)?.name}] đã bị Quản trò xử tử thủ công!`, "kill");
        } catch (error) {
            window.alert("Đã xảy ra lỗi khi thực thi lệnh tử hình!");
        }
    },

    updateStats: () => {
        const pCountDisp = document.getElementById('player-count-display');
        if (pCountDisp) pCountDisp.innerText = window.G.players.length;
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
        const name = getRoleName(key);
        const desc = getRoleDesc(key);
        window.alert(`[${name.toUpperCase()}]\n\n${desc}`);
    },

    showVictoryScreen: (winningFaction, mvpData, relationLogs) => {
        const modal = document.getElementById("victory-screen-modal");
        if (!modal) return;
        modal.style.display = "flex";

        const title = document.getElementById("victory-faction-title");
        const artContainer = document.getElementById("victory-visual-art");

        if (winningFaction === "villager") {
            title.innerText = "🌾 DÂN LÀNG CHIẾN THẮNG 🌾";
            title.style.color = "#16a34a";
            artContainer.innerHTML = `<div style="font-size:72px;">🕊️☀️🌻</div>`;
        } else if (winningFaction === "wolf") {
            title.innerText = "🐺 MA SÓI CHIẾN THẮNG 🐺";
            title.style.color = "#ef4444";
            artContainer.innerHTML = `<div style="font-size:72px;">🐺🩸🌑</div>`;
        } else if (winningFaction === "couple") {
            title.innerText = "💘 UYÊN ƯƠNG CHIẾN THẮNG 💘";
            title.style.color = "#ec4899";
            artContainer.innerHTML = `<div style="font-size:72px;">💘👩‍❤️‍💋‍👨👑</div>`;
        } else if (winningFaction === "clown") {
            title.innerText = "🤡 GÃ HỀ THẮNG ĐƠN LẬP 🤡";
            title.style.color = "#f59e0b";
            artContainer.innerHTML = `<div style="font-size:72px;">🤡🎪🎭</div>`;
        } else if (winningFaction === "arsonist") {
            title.innerText = "🔥 KẺ PHÓNG HỎA THẮNG ĐƠN LẬP 🔥";
            title.style.color = "#f97316";
            artContainer.innerHTML = `<div style="font-size:72px;">🔥🛢️🏰</div>`;
        } else if (winningFaction === "serialKiller") {
            title.innerText = "🔪 SÁT NHÂN THẮNG ĐƠN LẬP 🔪";
            title.style.color = "#dc2626";
            artContainer.innerHTML = `<div style="font-size:72px;">🔪🩸💀</div>`;
        } else {
            title.innerText = "🧛 PHE THỨ BA CHIẾN THẮNG 🧛";
            title.style.color = "#c084fc";
            artContainer.innerHTML = `<div style="font-size:72px;">🧛👑🔮</div>`;
        }

        const mvpName = document.getElementById("mvp-user-name");
        const mvpBadge = document.getElementById("mvp-badge-title");
        const mvpDetails = document.getElementById("mvp-stats-details");

        if (mvpData) {
            mvpName.innerText = mvpData.name || "Ẩn danh";
            mvpBadge.innerText = mvpData.badge || "Chiến Binh Sống Sót";
            mvpDetails.innerHTML = "";
            (mvpData.stats || []).forEach(stat => {
                mvpDetails.innerHTML += `
                    <div class="mvp-stat-row">
                        <span>${stat.label}</span>
                        <b>${stat.value}</b>
                    </div>`;
            });
        }

        renderRelationsTab(relationLogs);
    }
};

// ==========================================
// 8. SỰ KIỆN GIAO DIỆN CẤU HÌNH & BẢNG VINH DANH
// ==========================================
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
        applyPreset({ villager: 4, seer: 1, guard: 1, wolf: 2, wolfBoss: 1 });
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
    const Net = window.Net;
    if (!Net || !Net.isHost) return;
    
    const updates = {};
    for (let key in ROLE_DB) {
        updates[`rooms/${Net.roomId}/roleCounts/${key}`] = preset[key] || 0;
    }
    update(ref(db), updates);
}

// ==========================================
// 9. SƠ ĐỒ QUAN HỆ SỐ PHẬN SVG (RELATIONS CANVAS)
// ==========================================
let cachedRelationLogs = [];

function renderRelationsTab(relationLogs) {
    cachedRelationLogs = relationLogs || [];
    const container = document.getElementById("stats-unmasked-grid");
    if (!container) return;
    container.innerHTML = "";

    window.G.players.forEach(p => {
        container.innerHTML += `
            <div class="player-grid-card" id="relation-card-${p.id}" style="padding: 8px 4px; font-size:11px;">
                <b class="name" style="font-size:11px;">${p.name}</b>
                <span class="role-unmasked" style="font-size:10px;">(${getRoleName(p.role)})</span>
            </div>`;
    });
}

function triggerSgDrawingRelations() {
    const canvas = document.getElementById("svg-relations-canvas");
    if (!canvas) return;
    canvas.innerHTML = "";

    const container = document.getElementById("stats-content-map");
    if (!container || container.classList.contains("hidden")) return;

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

            if (log.type === "couple") {
                line.setAttribute("stroke", "#f472b6");
                line.setAttribute("stroke-dasharray", "4,4");
            } else if (log.type === "wolf_bite") {
                line.setAttribute("stroke", "#ef4444");
            } else if (log.type === "guard_protect") {
                line.setAttribute("stroke", "#22c55e");
            } else {
                line.setAttribute("stroke", "#38bdf8");
            }

            canvas.appendChild(line);
        }
    });
}

function initVictoryTabsListeners() {
    const tabs = document.querySelectorAll(".stats-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");

            const selectedTab = tab.getAttribute("data-stats-tab");
            const panels = ["stats-content-mvp", "stats-content-map", "stats-content-logs"];
            panels.forEach(p => document.getElementById(p)?.classList.add("hidden"));

            if (selectedTab === "mvp") {
                document.getElementById("stats-content-mvp")?.classList.remove("hidden");
            } else if (selectedTab === "map") {
                document.getElementById("stats-content-map")?.classList.remove("hidden");
                triggerSgDrawingRelations();
            } else if (selectedTab === "logs") {
                document.getElementById("stats-content-logs")?.classList.remove("hidden");
            }
        });
    });

    document.getElementById("btn-show-stats-board")?.addEventListener("click", () => {
        document.getElementById("victory-splash-panel")?.classList.add("hidden");
        document.getElementById("victory-stats-panel")?.classList.remove("hidden");
    });

    document.getElementById("btn-stats-back-lobby")?.addEventListener("click", () => {
        location.reload();
    });
}

// Gắn các Listener UI ngay khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", () => {
    initRoleSetupListeners();
    initVictoryTabsListeners();
    document.getElementById("lang-selector")?.addEventListener("change", (e) => {
        UI_Module.changeLang(e.target.value);
    });
});

window.UI_Module = UI_Module;
window.Engine_Module = Engine_Module;