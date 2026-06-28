import { 
    db, ref, set, get, onValue, update, push, remove, child, onDisconnect, runTransaction 
} from "./firebase-config.js";

// Trạng thái mạng cục bộ
export const Net = {
    roomId: null,
    playerId: null,
    playerName: "",
    isHost: false,
    players: {}, // Danh sách người chơi đồng bộ từ Firebase
    connectedRef: null
};

// Khởi tạo ứng dụng sảnh chờ
document.addEventListener("DOMContentLoaded", () => {
    initLobby();
    setupTabNavigation();
    setupThemeAndFontListeners();
});

// ==========================================
// 1. KHỞI TẠO VÀ ĐIỀU PHỐI SẢNH CHỜ (LOBBY)
// ==========================================
function initLobby() {
    const btnCreate = document.getElementById("btn-create-room");
    const btnJoin = document.getElementById("btn-join-room");
    const btnStartSetup = document.getElementById("btn-host-start-setup");
    const btnCloseSettings = document.getElementById("btn-close-settings");
    const btnDesktopSettings = document.getElementById("btn-desktop-settings");

    if (btnCreate) btnCreate.addEventListener("click", createRoom);
    if (btnJoin) btnJoin.addEventListener("click", joinRoomFromInput);
    if (btnStartSetup) btnStartSetup.addEventListener("click", hostStartSetup);
    
    if (btnDesktopSettings) btnDesktopSettings.addEventListener("click", toggleSettingsUI);
    if (btnCloseSettings) btnCloseSettings.addEventListener("click", toggleSettingsUI);

    // Tự động khôi phục thông tin từ LocalStorage nếu có
    const savedName = localStorage.getItem("online_player_name");
    if (savedName) {
        document.getElementById("player-name-input").value = savedName;
        Net.playerName = savedName;
    }
}

// Chuyển đổi hiển thị bảng điều khiển cài đặt hệ thống
function toggleSettingsUI() {
    const settingsPanel = document.getElementById("panel-settings-donate");
    if (settingsPanel) {
        const isVisible = settingsPanel.style.display === "flex" || settingsPanel.classList.contains("desktop-settings-active");
        if (isVisible) {
            settingsPanel.style.display = "none";
            settingsPanel.classList.remove("desktop-settings-active");
        } else {
            settingsPanel.style.display = "flex";
            if (window.innerWidth > 900) {
                settingsPanel.classList.add("desktop-settings-active");
            }
        }
    }
}

// Đăng ký sự kiện chuyển tab trên thiết bị di động
function setupTabNavigation() {
    const tabs = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
    tabs.forEach((tabId, idx) => {
        const el = document.getElementById(tabId);
        if (el) {
            el.addEventListener("click", () => {
                document.body.setAttribute("data-mobile-tab", idx + 1);
                tabs.forEach(t => {
                    const btn = document.getElementById(t);
                    if (btn) btn.classList.remove("active");
                });
                el.classList.add("active");
            });
        }
    });
}

// Lắng nghe thay đổi giao diện, phông chữ trực tiếp trên UI
function setupThemeAndFontListeners() {
    const themeSel = document.getElementById("theme-selector");
    const fontSel = document.getElementById("font-selector");
    const langSel = document.getElementById("lang-selector");

    if (themeSel) {
        themeSel.addEventListener("change", (e) => {
            document.body.setAttribute("data-theme", e.target.value);
            localStorage.setItem("gm_theme", e.target.value);
        });
    }
    if (fontSel) {
        fontSel.addEventListener("change", (e) => {
            document.body.setAttribute("data-font", e.target.value);
            localStorage.setItem("gm_font", e.target.value);
        });
    }
    if (langSel) {
        langSel.addEventListener("change", (e) => {
            // Chức năng đổi ngôn ngữ sẽ được liên kết thông qua game-logic
            if (window.UI_Module && typeof window.UI_Module.changeLang === "function") {
                window.UI_Module.changeLang(e.target.value);
            }
        });
    }
}

// Thu thập tên người chơi hợp lệ
function validatePlayerName() {
    const input = document.getElementById("player-name-input");
    const name = input.value.trim();
    if (!name) {
        alert("Vui lòng nhập tên hiển thị trước khi tiếp tục!");
        input.focus();
        return null;
    }
    localStorage.setItem("online_player_name", name);
    Net.playerName = name;
    return name;
}

// Sinh mã phòng ngẫu nhiên gồm 6 ký tự
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ==========================================
// 2. KẾT NỐI: TẠO PHÒNG & THAM GIA PHÒNG
// ==========================================

// Hàm tạo phòng mới dành cho Host
async function createRoom() {
    const name = validatePlayerName();
    if (!name) return;

    const roomId = generateRoomCode();
    Net.roomId = roomId;
    Net.playerId = "host_" + Date.now();
    Net.isHost = true;

    const roomRef = ref(db, `rooms/${roomId}`);
    const hostData = {
        id: Net.playerId,
        name: name,
        isHost: true,
        isConnected: true,
        alive: true,
        role: "villager",
        realFaction: "villager"
    };

    const initialRoomState = {
        meta: {
            hostId: Net.playerId,
            roomId: roomId,
            phase: "lobby",
            day: 0,
            started: false,
            createdTime: Date.now()
        },
        players: {
            [Net.playerId]: hostData
        },
        roleCounts: {
            villager: 1
        }
    };

    try {
        await set(roomRef, initialRoomState);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        console.error("Lỗi khi tạo phòng trên Firebase:", error);
        alert("Không thể tạo phòng. Vui lòng kiểm tra lại kết nối mạng!");
    }
}

// Đọc mã phòng từ giao diện để tham gia
function joinRoomFromInput() {
    const name = validatePlayerName();
    if (!name) return;

    const roomInput = document.getElementById("room-id-input");
    const roomId = roomInput.value.trim().toUpperCase();
    if (!roomId || roomId.length !== 6) {
        alert("Mã phòng không hợp lệ! Vui lòng nhập đúng 6 ký tự.");
        roomInput.focus();
        return;
    }
    joinRoom(roomId, name);
}

// Gửi yêu cầu tham gia phòng tới Firebase
async function joinRoom(roomId, name) {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            alert("Phòng không tồn tại! Vui lòng kiểm tra lại mã phòng.");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            alert("Trận đấu trong phòng này đã bắt đầu, không thể tham gia!");
            return;
        }

        Net.roomId = roomId;
        Net.playerId = "player_" + Date.now();
        Net.isHost = false;

        const playerRef = ref(db, `rooms/${roomId}/players/${Net.playerId}`);
        const playerData = {
            id: Net.playerId,
            name: name,
            isHost: false,
            isConnected: true,
            alive: true,
            role: "villager",
            realFaction: "villager"
        };

        await set(playerRef, playerData);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        console.error("Lỗi khi kết nối phòng:", error);
        alert("Có lỗi xảy ra khi tham gia phòng trực tuyến!");
    }
}

// Chuyển đổi giao diện sang chế độ chờ tại sảnh
function enterLobbyMode() {
    document.getElementById("lobby-room-status").classList.remove("hidden");
    document.getElementById("current-room-display").innerText = Net.roomId;
    
    const hostControls = document.getElementById("lobby-host-controls");
    const waitingMsg = document.getElementById("lobby-waiting-msg");

    if (Net.isHost) {
        hostControls.classList.remove("hidden");
        waitingMsg.classList.add("hidden");
    } else {
        hostControls.classList.add("hidden");
        waitingMsg.classList.remove("hidden");
    }

    // Đăng ký sự kiện rớt mạng tự động xóa người chơi
    setupPresenceSystem();
}

// Đăng ký trạng thái rớt mạng thời gian thực
function setupPresenceSystem() {
    const playerOnlineRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    const myPresenceRef = ref(db, `.info/connected`);

    onValue(myPresenceRef, (snap) => {
        if (snap.val() === true) {
            // Khi mất kết nối mạng, Firebase Realtime Database tự động chuyển trạng thái offline
            onDisconnect(playerOnlineRef).set(false);
            set(playerOnlineRef, true);
        }
    });
}

// ==========================================
// 3. ĐỒNG BỘ TRẠNG THÁI TRẬN ĐẤU (SYNC & EVENT ENGINE)
// ==========================================

// Lắng nghe liên tục biến động trạng thái từ phòng trên Firebase
function listenToRoom() {
    const roomRef = ref(db, `rooms/${Net.roomId}`);
    
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            handleRoomTerminated();
            return;
        }

        const data = snapshot.val();
        Net.players = data.players || {};
        
        // Cập nhật danh sách người chơi tại sảnh chờ
        updateLobbyPlayersUI();

        // Xử lý chuyển đổi màn hình khi game bắt đầu
        if (data.meta.started && document.body.getAttribute("data-view") === "lobby") {
            transitionToGameScreen(data);
        }

        // Nếu trận đấu đang diễn ra, thực hiện đồng bộ hóa toàn diện sang Logic của trò chơi
        if (data.meta.started) {
            syncGameStateWithEngine(data);
        }
    });
}

// Cập nhật danh sách người chơi hiển thị trong sảnh chờ (Lobby)
function updateLobbyPlayersUI() {
    const listContainer = document.getElementById("lobby-players-list");
    const connectedCount = document.getElementById("lobby-connected-count");
    if (!listContainer) return;

    listContainer.innerHTML = "";
    let count = 0;

    Object.values(Net.players).forEach(p => {
        if (p.isConnected) {
            count++;
            const tag = document.createElement("div");
            tag.className = `lobby-player-tag ${p.isHost ? 'is-host' : ''}`;
            tag.innerText = p.name;
            listContainer.appendChild(tag);
        }
    });

    if (connectedCount) connectedCount.innerText = count;
}

// Chủ phòng yêu cầu khởi chạy chuyển đổi cấu hình
async function hostStartSetup() {
    if (!Net.isHost) return;
    const roomMetaRef = ref(db, `rooms/${Net.roomId}/meta`);
    
    try {
        await update(roomMetaRef, {
            phase: "setup",
            started: true
        });
    } catch (error) {
        alert("Không thể chuyển hướng thiết lập trận đấu!");
    }
}

// Xử lý khi chủ phòng hủy phòng hoặc phòng không tồn tại
function handleRoomTerminated() {
    alert("Phòng chơi đã bị giải tán hoặc mất kết nối!");
    localStorage.removeItem("online_room_id");
    location.reload();
}

// Chuyển dịch sảnh chờ sang màn hình trò chơi chính thức
function transitionToGameScreen(roomData) {
    document.body.setAttribute("data-view", "game");
    document.getElementById("lobby-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");

    // Phân quyền hiển thị cột cấu hình vai trò
    const colRoles = document.getElementById("col-roles");
    if (Net.isHost) {
        colRoles.classList.remove("hidden");
    } else {
        colRoles.classList.add("hidden");
        // Ẩn tab Role trên thiết bị di động của người chơi thường
        const navTab2 = document.getElementById("nav-tab2");
        if (navTab2) navTab2.style.display = "none";
    }

    if (window.UI_Module && typeof window.UI_Module.switchTab === "function") {
        window.UI_Module.switchTab(3); // Mặc định mở tab Board
    }
}

// ==========================================
// 4. CHUYỂN GIAO & ĐỒNG BỘ ENGINE LOGIC CỦA GAME
// ==========================================

// Đồng bộ trạng thái từ Firebase về mô hình dữ liệu G của Game Logic
function syncGameStateWithEngine(roomData) {
    // Nếu tệp game-logic.js chưa được tải kịp, bỏ qua vòng quét này
    if (!window.G) return;

    const oldPhase = window.G.phase;
    
    // Áp dụng dữ liệu máy chủ lên cấu trúc dữ liệu cục bộ G
    window.G.day = roomData.meta.day || 0;
    window.G.phase = roomData.meta.phase || "setup";
    
    // Đồng bộ danh sách người chơi
    const mappedPlayers = Object.values(roomData.players).map(p => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        role: p.role,
        realFaction: p.realFaction,
        isHost: p.isHost,
        isConnected: p.isConnected
    }));
    
    window.G.players = mappedPlayers;

    // Đồng bộ cấu hình vai trò của chủ phòng
    if (roomData.roleCounts) {
        window.G.roleCounts = roomData.roleCounts;
    }

    // Yêu cầu Giao diện cập nhật thông số từ mô hình dữ liệu cục bộ mới
    if (window.UI_Module && typeof window.UI_Module.renderPlayers === "function") {
        window.UI_Module.renderPlayers();
        window.UI_Module.updateStats();
        window.UI_Module.updateActiveRolesSummary();
        window.UI_Module.updateBalanceUI();
    }

    // Điều khiển trạng thái hộp điều khiển Board dựa trên pha hiện tại
    updateBoardStatusUI(roomData);
}

// Cập nhật giao diện của Bàn điều khiển (Board) tùy theo vai trò cục bộ
function updateBoardStatusUI(roomData) {
    const phaseTitle = document.getElementById("phase-title");
    const scriptText = document.getElementById("script-text");
    const controlsContainer = document.getElementById("controls");

    if (!phaseTitle || !scriptText || !controlsContainer) return;

    const meta = roomData.meta;
    const mySelf = Net.players[Net.playerId];

    // 1. GIAO DIỆN Ở PHA SET UP TRẬN ĐẤU
    if (meta.phase === "setup") {
        phaseTitle.innerText = "THIẾT LẬP TRẬN ĐẤU TRỰC TUYẾN";
        if (Net.isHost) {
            scriptText.innerText = "Hãy cấu hình số lượng vai trò phù hợp, sau đó ấn [Trộn & Phát Role]!";
            controlsContainer.innerHTML = `<button id="btn-net-start-game" class="btn-success w-100" style="padding:15px; font-size:18px;">🚀 BẮT ĐẦU TRẬN ĐẤU</button>`;
            
            // Lắng nghe nút khởi chạy game trực tuyến
            document.getElementById("btn-net-start-game").addEventListener("click", () => {
                if (window.Engine_Module && typeof window.Engine_Module.startGame === "function") {
                    window.Engine_Module.startGame();
                }
            });
        } else {
            scriptText.innerText = "Vui lòng chờ Quản trò thiết lập vai trò và bắt đầu trò chơi...";
            controlsContainer.innerHTML = `<div class="waiting-msg">Đang chờ quản trò...</div>`;
        }
        return;
    }

    // 2. GIAO DIỆN ĐANG CHƠI (NIGHT / DAY)
    phaseTitle.innerText = meta.phase.toUpperCase() + ` - NGÀY SỐ ${meta.day}`;
    
    // Nếu người chơi đã chết
    if (mySelf && !mySelf.alive) {
        scriptText.innerText = "Bạn đã hy sinh! Hãy giữ im lặng để không ảnh hưởng đến diễn biến trận đấu.";
        controlsContainer.innerHTML = `<button class="btn-danger w-100" disabled>💀 ĐÃ CHẾT</button>`;
        return;
    }

    // Phân nhánh giao diện hiển thị cho Host (Quản trò tối cao) và Client (Người chơi thường)
    if (Net.isHost) {
        renderHostBoardControls(meta, roomData);
    } else {
        renderPlayerBoardControls(meta, mySelf, roomData);
    }
}

// Bảng điều khiển dành riêng cho Chủ phòng (GM / Host)
function renderHostBoardControls(meta, roomData) {
    const scriptText = document.getElementById("script-text");
    const controlsContainer = document.getElementById("controls");

    scriptText.innerText = "Quản trò trực tuyến: Theo dõi và tiến hành chuyển pha sau khi người chơi hoàn thành lượt.";
    
    // Giao diện GM bao gồm các nút tiến trình của trận đấu
    controls.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; width:100%;">
            <button id="btn-net-next-phase" class="btn-success">Chuyển Sang Ban Đêm 🌙</button>
            <button id="btn-net-resolve-vote" class="btn-danger">⚖️ Chốt Phiếu Xử Tử</button>
        </div>
    `;

    document.getElementById("btn-host-start-setup")?.classList.add("hidden");
}

// Bảng điều khiển dành riêng cho người chơi trực tuyến (Player View)
function renderPlayerPerspective(roomData) {
    // Logic của người chơi sẽ được tự động cập nhật từ kịch bản gửi về
}

// ==========================================
// 4. KẾT NỐI TƯƠNG TÁC GỬI HÀNH ĐỘNG LÊN SERVER
// ==========================================

// Gửi hành động đêm lên cơ sở dữ liệu để đồng bộ hóa
export async function dbSendNightAction(roleKey, targetPlayerId) {
    if (!Net.roomId) return;
    const actionRef = ref(db, `rooms/${Net.roomId}/actions/${roleKey}`);
    
    try {
        await set(actionRef, {
            actorId: Net.playerId,
            targetId: targetPlayerId,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Lỗi gửi hành động lên Firebase:", error);
    }
}

// Gửi phiếu biểu quyết trong pha thảo luận ngày
export async function dbCastDayVote(votedPlayerId) {
    if (!Net.roomId) return;
    const voteRef = ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`);
    
    try {
        await set(voteRef, {
            voterId: Net.playerId,
            targetId: votedPlayerId,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Lỗi biểu quyết:", error);
    }
}