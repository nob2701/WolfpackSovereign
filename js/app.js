import { 
    db, ref, set, get, onValue, update, push, onDisconnect 
} from "./firebase-config.js";
import { StateMachine } from "./state-machine.js";
import { 
    openTargetSelection, ModalManager, initMobileTabSync, showPlayerBottomSheet, setupSoundSettings, showToast, askConfirm
} from "./ui-manager.js";
import { ROLE_DB, ROLE_ICONS, FACTION_ICONS, getRoleName } from "./game-logic.js";

// Trạng thái mạng và đồng bộ cục bộ của Client
export const Net = {
    roomId: null,
    playerId: null,
    playerName: "",
    isHost: false,
    players: {}, 
    currentChannel: "public",
    mailCategory: "all"
};

window.Net = Net;

// SỬA BUG 3: Hợp nhất biến quản lý Listener để chống tràn RAM
let activeUnsubscribers = [];
let activeChatUnsub = null;

// Lịch sử hòm thư
let openedMailsList = [];
let currentMailIndex = -1;

// ==========================================
// KHỞI TẠO ỨNG DỤNG (INITIALIZATION)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initLobbyEngine();
    setupCodeInputNavigation();
    initMobileTabSync();
    setupSoundSettings();
    
    // Tự động kích hoạt luồng phục hồi phiên chơi cũ
    attemptSessionReconnection();

    // Hẹn giờ tắt màn hình chờ (Nếu không có reconnect)
    setTimeout(dismissSplashScreen, 1500);
});

function dismissSplashScreen() {
    const splash = document.getElementById("splash-screen");
    if (splash) splash.classList.add("hidden");
}

function clearActiveListeners() {
    activeUnsubscribers.forEach(unsub => {
        if (typeof unsub === "function") unsub();
    });
    activeUnsubscribers = [];
}

// ==========================================
// 1. LUỒNG ĐĂNG KÝ VÀ LOBBY (LOGIN ENGINE)
// ==========================================
function initLobbyEngine() {
    const nameInput = document.getElementById("player-name-input");
    const btnInitialJoin = document.getElementById("btn-initial-join-trigger");
    const btnCreate = document.getElementById("btn-create-room");
    const btnJoinSubmit = document.getElementById("btn-join-room-submit");
    const btnBackToLogin = document.getElementById("btn-back-to-login");
    const btnCopyRoom = document.getElementById("btn-copy-room-id");
    const btnToggleReady = document.getElementById("btn-player-toggle-ready");
    const btnHostStartSetup = document.getElementById("btn-host-start-setup");

    const savedName = localStorage.getItem("online_player_name");
    if (savedName && nameInput) {
        nameInput.value = savedName;
        Net.playerName = savedName;
        btnInitialJoin.disabled = savedName.length < 2;
        btnCreate.disabled = savedName.length < 2;
    }

    if (nameInput) {
        nameInput.addEventListener("input", () => {
            const cleanName = nameInput.value.trim().replace(/[^a-zA-Z0-9\sÀ-ỹ]/g, "");
            nameInput.value = cleanName;
            const isValid = cleanName.length >= 2;
            btnInitialJoin.disabled = !isValid;
            btnCreate.disabled = !isValid;
            Net.playerName = cleanName;
        });
    }

    if (btnInitialJoin) {
        btnInitialJoin.addEventListener("click", () => {
            localStorage.setItem("online_player_name", Net.playerName);
            document.getElementById("login-form-panel").classList.add("hidden");
            document.getElementById("join-code-panel").classList.remove("hidden");
        });
    }

    if (btnBackToLogin) {
        btnBackToLogin.addEventListener("click", () => {
            document.getElementById("join-code-panel").classList.add("hidden");
            document.getElementById("login-form-panel").classList.remove("hidden");
        });
    }

    if (btnCreate) btnCreate.addEventListener("click", createRoom);
    if (btnJoinSubmit) btnJoinSubmit.addEventListener("click", joinRoomFromInputs);
    if (btnCopyRoom) btnCopyRoom.addEventListener("click", copyRoomId);
    if (btnToggleReady) btnToggleReady.addEventListener("click", toggleReadyState);
    if (btnHostStartSetup) btnHostStartSetup.addEventListener("click", hostStartSetup);

    document.getElementById("btn-gm-force-day")?.addEventListener("click", () => {
        askConfirm("Bạn có chắc chắn muốn cưỡng chế chuyển sang BAN NGÀY lập tức? Mọi hành động chưa thực hiện của người chơi đêm nay sẽ bị bỏ qua!", () => {
            StateMachine.forceTransitionToDay();
        });
    });
}

function setupCodeInputNavigation() {
    const inputs = document.querySelectorAll(".code-input");
    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
            
            let code = "";
            inputs.forEach(i => code += i.value);
            const btnJoinSubmit = document.getElementById("btn-join-room-submit");
            if (btnJoinSubmit) btnJoinSubmit.disabled = code.length !== 6;
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && index > 0) inputs[index - 1].focus();
        });
    });
}

// ==========================================
// 2. KẾT NỐI VÀ QUẢN LÝ PHÒNG TRỰC TUYẾN
// ==========================================
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

// SỬA BUG 4: Chuyển onDisconnect vào đây, chỉ chạy 1 lần lúc tạo/vào phòng
function setupActivePlayersPresence() {
    const connectionRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    set(connectionRef, true);
    onDisconnect(connectionRef).set(false);
}

async function createRoom() {
    if (Net.playerName.length < 2) return;
    const roomId = generateRoomCode();
    Net.roomId = roomId;
    Net.playerId = "host_" + Date.now();
    Net.isHost = true;

    localStorage.setItem("reconnect_room_id", roomId);
    localStorage.setItem("reconnect_player_id", Net.playerId);

    const initialRoomState = {
        meta: {
            hostId: Net.playerId,
            roomId: roomId,
            phase: "setup",
            day: 0,
            started: false,
            createdTime: Date.now()
        },
        players: {
            [Net.playerId]: {
                id: Net.playerId, name: Net.playerName, isHost: true, isReady: true,
                isConnected: true, alive: true, role: "villager", realFaction: "villager",
                turnEnded: false, hasSeenRole: false
            }
        },
        roleCounts: { villager: 1 }
    };

    try {
        await set(ref(db, `rooms/${roomId}`), initialRoomState);
        setupActivePlayersPresence();
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        showToast("Lỗi khi kết nối máy chủ để khởi tạo phòng!", "danger");
    }
}

function joinRoomFromInputs() {
    let code = "";
    document.querySelectorAll(".code-input").forEach(i => code += i.value);
    if (code.length === 6) joinRoom(code, Net.playerName);
}

async function joinRoom(roomId, name) {
    const roomRef = ref(db, `rooms/${roomId}`);
    try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            showToast("Mã phòng không tồn tại!", "danger");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            showToast("Ván đấu trong phòng đã bắt đầu, không thể tham gia!", "danger");
            return;
        }

        Net.roomId = roomId;
        Net.playerId = "player_" + Date.now();
        Net.isHost = false;

        localStorage.setItem("reconnect_room_id", roomId);
        localStorage.setItem("reconnect_player_id", Net.playerId);

        await set(ref(db, `rooms/${roomId}/players/${Net.playerId}`), {
            id: Net.playerId, name: name, isHost: false, isReady: false,
            isConnected: true, alive: true, role: "villager", realFaction: "villager",
            turnEnded: false, hasSeenRole: false
        });
        
        setupActivePlayersPresence();
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        showToast("Gặp sự cố khi gia nhập phòng trực tuyến!", "danger");
    }
}

async function attemptSessionReconnection() {
    const savedRoomId = localStorage.getItem("reconnect_room_id");
    const savedPlayerId = localStorage.getItem("reconnect_player_id");

    if (savedRoomId && savedPlayerId) {
        const overlay = document.getElementById("reconnect-overlay");
        if (overlay) overlay.style.display = "flex";

        try {
            const snapshot = await get(ref(db, `rooms/${savedRoomId}`));
            if (snapshot.exists()) {
                const roomData = snapshot.val();
                if (roomData.players && roomData.players[savedPlayerId]) {
                    Net.roomId = savedRoomId;
                    Net.playerId = savedPlayerId;
                    Net.playerName = roomData.players[savedPlayerId].name;
                    Net.isHost = roomData.players[savedPlayerId].isHost;
                    
                    // SỬA BUG 10: Tắt ngay lập tức Splash Screen khi khôi phục thành công
                    dismissSplashScreen();
                    
                    setupActivePlayersPresence();
                    enterLobbyMode();
                    
                    if (roomData.meta.started) transitionToGameScreen(roomData);
                    
                    listenToRoom();
                    showToast("Khôi phục phiên kết nối cũ thành công!", "success");
                } else {
                    cleanSessionStorage();
                }
            } else {
                cleanSessionStorage();
            }
        } catch (err) {
            cleanSessionStorage();
        } finally {
            if (overlay) overlay.style.display = "none";
        }
    }
}

function cleanSessionStorage() {
    localStorage.removeItem("reconnect_room_id");
    localStorage.removeItem("reconnect_player_id");
}

function enterLobbyMode() {
    document.getElementById("login-form-panel").classList.add("hidden");
    document.getElementById("join-code-panel").classList.add("hidden");
    document.getElementById("lobby-room-status").classList.remove("hidden");
    document.getElementById("current-room-display").innerText = Net.roomId;

    const hostCtrl = document.getElementById("lobby-host-controls");
    const playerCtrl = document.getElementById("lobby-player-controls");
    const waitingMsg = document.getElementById("lobby-waiting-msg");

    if (Net.isHost) {
        hostCtrl.classList.remove("hidden");
        playerCtrl.classList.add("hidden");
        waitingMsg.classList.add("hidden");
    } else {
        hostCtrl.classList.add("hidden");
        playerCtrl.classList.remove("hidden");
        waitingMsg.classList.remove("hidden");
    }

    // Đã vào phòng thành công, khởi động các Module phụ trợ
    setupChatEngine();
    setupSpectatorWinPoll();
    setupMailboxCategoryFilters();
    setupParchmentNavigation();
}

// ==========================================
// 3. ĐỒNG BỘ THỜI GIAN THỰC (REALTIME LISTENER)
// ==========================================
function listenToRoom() {
    clearActiveListeners();
    
    // Bug 4: Đã xóa setupActivePlayersPresence() khỏi đây để chống dội bom DB

    const unsubRoom = onValue(ref(db, `rooms/${Net.roomId}`), (snapshot) => {
        if (!snapshot.exists()) return;
        const roomData = snapshot.val();
        
        window.G.day = roomData.meta.day || 0;
        window.G.phase = roomData.meta.phase || "setup";
        window.G.players = Object.values(roomData.players || {});
        window.G.roleCounts = roomData.roleCounts || {};
        Net.players = roomData.players || {};

        renderPlayersGridSmartly();

        const connectedCount = window.G.players.filter(p => p.isConnected).length;
        const lobbyConnectedEl = document.getElementById("lobby-connected-count");
        if (lobbyConnectedEl) lobbyConnectedEl.innerText = connectedCount;

        if (!roomData.meta.started) {
            renderLobbyPlayersList();
            if (Net.isHost) {
                const otherPlayers = window.G.players.filter(p => p.id !== Net.playerId);
                const allReady = otherPlayers.length > 0 && otherPlayers.every(p => p.isReady);
                document.getElementById("btn-host-start-setup").disabled = !allReady;
            }
        } else {
            if (document.body.getAttribute("data-view") === "lobby") {
                transitionToGameScreen(roomData);
            }

            if (roomData.meta.phase === "victory" && roomData.meta.winner) {
                window.UI_Module.showVictoryScreen(roomData.meta.winner, roomData.meta.mvp, roomData.meta.relations);
            }

            syncLayoutBasedOnRoleAndStatus(roomData);
            syncTrialPhases(roomData);
            updateSovereignStatusAndGuide(roomData);
            
            // Host tự động chuyển pha
            if (Net.isHost) {
                if (roomData.meta.phase === "night") {
                    StateMachine.checkAndAutoTransitionToDay();
                } else if (roomData.meta.phase === "day" && roomData.nominations) {
                    // SỬA BUG 1: Chốt chặn an toàn, chỉ kiểm tra quá bán khi không có ai đang bị xét xử
                    if (!roomData.trial || roomData.trial.stage === "none") {
                        window.checkMajorityNominationTrigger();
                    }
                }
            }
        }
        updateBalanceAndCountsUI();
    });
    activeUnsubscribers.push(unsubRoom);

    if (!Net.isHost) {
        const unsubMailbox = onValue(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`), (snap) => {
            renderMailbox(snap.val() || {});
        });
        activeUnsubscribers.push(unsubMailbox);
    }

    if (Net.isHost) {
        const unsubLogs = onValue(ref(db, `rooms/${Net.roomId}/logs`), (snap) => {
            renderGMLogs(snap.val() || {});
        });
        activeUnsubscribers.push(unsubLogs);
    }
}

function renderLobbyPlayersList() {
    const listContainer = document.getElementById("lobby-players-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";

    window.G.players.forEach(p => {
        const tag = document.createElement("div");
        tag.className = "lobby-player-tag";
        
        const nameSpan = document.createElement("span");
        nameSpan.innerText = p.name + (p.isHost ? " 👑" : "");
        nameSpan.style.fontWeight = "bold";

        const badge = document.createElement("span");
        if (p.isHost) {
            badge.className = "status-badge ready";
            badge.innerText = "Quản trò";
        } else {
            badge.className = p.isReady ? "status-badge ready" : "status-badge waiting";
            badge.innerText = p.isReady ? "Sẵn sàng" : "Chờ...";
        }

        tag.appendChild(nameSpan);
        tag.appendChild(badge);
        listContainer.appendChild(tag);
    });
}

function transitionToGameScreen(roomData) {
    document.body.setAttribute("data-view", "game");
    document.getElementById("lobby-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");

    if (Net.isHost) {
        document.getElementById("gm-timeline-container").classList.remove("hidden");
        document.getElementById("player-mailbox-container").classList.add("hidden");
    } else {
        document.getElementById("gm-timeline-container").classList.add("hidden");
        document.getElementById("player-mailbox-container").classList.remove("hidden");
    }
}

// ==========================================
// 4. QUẢN LÝ BẢO MẬT GIAO DIỆN CHAT & ĐÊM (SỬA BUG 11)
// ==========================================
function syncLayoutBasedOnRoleAndStatus(roomData) {
    const mySelf = Net.players[Net.playerId];
    const phase = roomData.meta?.phase || "setup";
    
    // Màn hình ngủ sương mù
    const sleepOverlay = document.getElementById("night-sleep-overlay");
    if (sleepOverlay) {
        if (phase === "night" && mySelf && mySelf.alive && mySelf.turnEnded) {
            sleepOverlay.classList.remove("hidden");
        } else {
            sleepOverlay.classList.add("hidden");
        }
    }

    const chatInputField = document.getElementById("chat-input-field");
    const chatSendBtn = document.getElementById("btn-chat-send");
    
    // MẢNG CÁC KÊNH BÍ MẬT
    const secretChannels = ["chan-wolf", "chan-couple", "chan-prime", "chan-vampire", "chan-reaper"];

    if (phase === "night") {
        if (Net.currentChannel === "public") {
            if (chatInputField) {
                chatInputField.disabled = true;
                chatInputField.placeholder = "Đêm đã buông xuống, toàn làng đang ngủ say... Hãy giữ im lặng!";
            }
            if (chatSendBtn) chatSendBtn.disabled = true;
        } else {
            if (chatInputField) {
                chatInputField.disabled = false;
                chatInputField.placeholder = "Nhập tin nhắn nội bộ phe cánh...";
            }
            if (chatSendBtn) chatSendBtn.disabled = false;
        }

        if (mySelf && mySelf.alive) {
            if (mySelf.role === "wolf" || mySelf.realFaction === "wolf") document.getElementById("chan-wolf")?.classList.remove("hidden");
            if (mySelf.inCouple && mySelf.coupleId) document.getElementById("chan-couple")?.classList.remove("hidden");
            if (mySelf.primeCovenantId) document.getElementById("chan-prime")?.classList.remove("hidden");
            if (mySelf.vampireFactionId) document.getElementById("chan-vampire")?.classList.remove("hidden");
            if (mySelf.role === "reaper" || mySelf.role === "apprenticeSeer" || mySelf.role === "apprenticeReaper") document.getElementById("chan-reaper")?.classList.remove("hidden");
        }
    } else {
        // SỬA BUG 11: BẢO MẬT TUYỆT ĐỐI BAN NGÀY
        secretChannels.forEach(ch => {
            document.getElementById(ch)?.classList.add("hidden");
        });

        // Ép văng về kênh an toàn nếu đang ở kênh bí mật
        if (Net.currentChannel !== "public" && Net.currentChannel !== "graveyard") {
            if (mySelf && mySelf.alive) {
                document.getElementById("chan-public")?.click();
            } else {
                document.getElementById("chan-graveyard")?.click();
            }
        }

        if (mySelf && mySelf.alive) {
            if (mySelf.isSilencerMuted) {
                if (chatInputField) {
                    chatInputField.disabled = true;
                    chatInputField.placeholder = "Bạn đang bị câm lặng (Muted) hôm nay... Im lặng!";
                }
                if (chatSendBtn) chatSendBtn.disabled = true;
            } else {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Thảo luận công khai cùng làng...";
                }
                if (chatSendBtn) chatSendBtn.disabled = false;
            }
        } else {
            if (Net.currentChannel === "graveyard") {
                if (chatInputField) {
                    chatInputField.disabled = false;
                    chatInputField.placeholder = "Linh hồn thảo luận ngầm...";
                }
                if (chatSendBtn) chatSendBtn.disabled = false;
            } else {
                if (chatInputField) {
                    chatInputField.disabled = true;
                    chatInputField.placeholder = "Bạn đã hy sinh, chuyển sang tab Linh Hồn để chat.";
                }
                if (chatSendBtn) chatSendBtn.disabled = true;
            }
        }
    }

    const forceDayBtn = document.getElementById("btn-gm-force-day");
    if (Net.isHost && phase === "night") forceDayBtn?.classList.remove("hidden");
    else forceDayBtn?.classList.add("hidden");

    updatePlayerIdentityCard(mySelf);
    renderDynamicActionControls(roomData, mySelf);
}

function updatePlayerIdentityCard(mySelf) {
    const idCard = document.getElementById("player-identity-card");
    const idRoleVal = document.getElementById("id-role-val");
    const idFactionVal = document.getElementById("id-faction-val");
    const idSkillsSummary = document.getElementById("id-skills-summary");

    if (!idCard || !mySelf) return;
    if (Net.isHost) { idCard.classList.add("hidden"); return; }

    idCard.classList.remove("hidden");
    idRoleVal.innerText = getRoleName(mySelf.role).toUpperCase();
    idFactionVal.innerText = mySelf.realFaction.toUpperCase();

    const skills = ROLE_DB[mySelf.role]?.faction === "wolf" ? "Phe phái Ma Sói: Đồng tâm cắn phá vào ban đêm." : "Phe Làng: Thảo luận tìm kiếm Ma Sói ban ngày.";
    idSkillsSummary.innerText = skills;
}

function updateSovereignStatusAndGuide(roomData) {
    const phase = roomData.meta.phase;
    const day = roomData.meta.day;
    const pTitle = document.getElementById("phase-title");
    const scriptText = document.getElementById("script-text");

    if (pTitle) pTitle.innerText = phase === "night" ? `🌙 ĐÊM ĐEN THỨ ${day}` : `☀️ BAN NGÀY THỨ ${day}`;
    if (scriptText) scriptText.innerText = phase === "night" ? "Đêm tối ma mị bao phủ toàn quốc... Thần dân hãy nhắm mắt đi ngủ!" : "Bình minh hé rạng! Hãy thảo luận tự do tìm kiếm dấu vết Ma Sói.";
}

function renderDynamicActionControls(roomData, mySelf) {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel || !mySelf) return;
    const phase = roomData.meta?.phase || "setup";

    if (phase === "night") {
        if (!mySelf.alive) {
            controlPanel.innerHTML = `<p style="color:var(--log-text); font-style:italic;">Bạn đã hy sinh. Đang theo dõi ván đấu dưới dạng linh hồn...</p>`;
            return;
        }

        if (mySelf.turnEnded) {
            controlPanel.innerHTML = `<p style="color:var(--success); font-weight:bold; animation: blinker 1.5s infinite;">Đã xác nhận kết thúc lượt! Đang ngủ say chờ ngày dậy...</p>`;
            return;
        }

        const PASSIVE_NIGHT_ROLES_CHECK = (role) => ["villager", "clown", "idiot", "ghost", "halfWolf", "apprenticeSeer", "doppelganger", "lostChild"].includes(role);
        const hasSkill = !PASSIVE_NIGHT_ROLES_CHECK(mySelf.role);
        const rIcon = ROLE_ICONS[mySelf.role] || "🔮";

        controlPanel.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                ${hasSkill ? `<button id="btn-use-skill" class="btn-accent w-100">${rIcon} KÍCH HOẠT KỸ NĂNG ĐÊM</button>` : `<p style="color:var(--log-text);">Bạn là vai trò thụ động. Hãy yên lặng đi ngủ.</p>`}
                <button id="btn-end-turn" class="btn-success w-100">💤 XÁC NHẬN KẾT THÚC LƯỢT</button>
            </div>
        `;

        document.getElementById("btn-use-skill")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), mySelf.role, (targetPlayerId, secondaryId, chosenModifier, phrase) => {
                set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/targetSelection`), {
                    actionType: chosenModifier || (mySelf.role + "_action"), 
                    targetId: targetPlayerId,
                    secondaryId: secondaryId,
                    phrase: phrase,
                    timestamp: Date.now()
                });
                showToast("Đã ghi nhận mục tiêu hành động đêm của bạn!", "success");
            });
        });

        document.getElementById("btn-end-turn")?.addEventListener("click", async () => {
            try { await update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), { turnEnded: true }); } 
            catch (err) { console.error(err); }
        });

    } else if (phase === "day") {
        if (!mySelf.alive) {
            controlPanel.innerHTML = `<p style="color:var(--log-text); font-style:italic;">Bạn đã chết. Thể xác không thể lên tiếng.</p>`;
            return;
        }
        controlPanel.innerHTML = `
            <div style="display:flex; gap:10px; width:100%;">
                <button id="btn-nominate-vote" class="btn-danger w-100">⚖️ ĐỀ CỬ LÊN ĐÀI BIỆN HỘ</button>
            </div>
        `;
        document.getElementById("btn-nominate-vote")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), "nominate", (targetId) => {
                window.Engine_Module.accusePlayer(targetId);
            });
        });
    }
}

// ==========================================
// 5. ĐỒNG BỘ TIẾN TRÌNH BIỂU QUYẾT (TRIAL STAGE)
// ==========================================
function syncTrialPhases(roomData) {
    const trial = roomData.trial || { stage: "none", accusedId: null };
    const stageContainer = document.getElementById("trial-stage-container");

    const steps = ["step-ind-1", "step-ind-2", "step-ind-3", "step-ind-4"];
    steps.forEach(st => document.getElementById(st)?.classList.remove("active"));

    if (trial.stage === "none") {
        stageContainer.classList.add("hidden");
        document.getElementById("vote-modal").style.display = "none";
        document.getElementById("trial-vote-progress-wrapper")?.classList.add("hidden");
        return;
    }

    stageContainer.classList.remove("hidden");

    if (trial.stage === "nomination") document.getElementById("step-ind-1").classList.add("active");

    if (trial.stage === "defense") {
        document.getElementById("step-ind-2").classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        
        if (Net.playerId === trial.accusedId) renderDefenseTypingPanel(true);
        else renderDefenseTypingPanel(false, accusedName);
    }

    if (trial.stage === "vote") {
        document.getElementById("step-ind-2").classList.add("active");
        document.getElementById("step-ind-3").classList.add("active");
        openSplitScreenVoteModal(trial.accusedId, roomData);
    }

    if (trial.stage === "verdict") {
        document.getElementById("step-ind-4").classList.add("active");
        document.getElementById("vote-modal").style.display = "none";
    }
}

function renderDefenseTypingPanel(isAccused, accusedName = "") {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel) return;

    if (isAccused) {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; border:2px solid var(--accent)">
                <textarea id="defense-typing-area" placeholder="Nhập lời biện hộ cứu rỗi bản thân của bạn tại đây..." style="width:100%; height:80px; background:var(--bg-main); color:white; border-radius:6px; padding:8px; border:1px solid var(--border-color);"></textarea>
                <button id="btn-submit-defense-speech" class="btn-success w-100" style="margin-top:10px;">Gửi Lời Biện Hộ</button>
            </div>
        `;
        
        const area = document.getElementById("defense-typing-area");
        area.addEventListener("input", () => update(ref(db, `rooms/${Net.roomId}/trial`), { accusedText: area.value }));
        document.getElementById("btn-submit-defense-speech")?.addEventListener("click", () => update(ref(db, `rooms/${Net.roomId}/trial`), { stage: "vote" }));
    } else {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; text-align:left; min-height:80px; border-left:4px solid var(--accent);">
                <p id="defense-realtime-display" style="font-style:italic; margin:0; color:var(--accent);">Bị cáo đang soạn thảo lời bào chữa...</p>
            </div>
        `;
        const unsubText = onValue(ref(db, `rooms/${Net.roomId}/trial/accusedText`), (snap) => {
            const display = document.getElementById("defense-realtime-display");
            if (display) display.innerText = `"${snap.val() || "..."}"`;
        });
        activeUnsubscribers.push(unsubText);
    }
}

function openSplitScreenVoteModal(accusedId, roomData) {
    const modal = document.getElementById("vote-modal");
    if (!modal) return;
    modal.style.display = "flex";

    document.getElementById("vote-modal-title").innerText = `PHÁN QUYẾT SỐ PHẬN: ${Net.players[accusedId]?.name?.toUpperCase()}`;

    const listAcquit = document.getElementById("list-voters-acquit");
    const listExecute = document.getElementById("list-voters-execute");
    listAcquit.innerHTML = "";
    listExecute.innerHTML = "";

    const votes = roomData.votes || {};
    let countAcquit = 0; let countExecute = 0;

    Object.entries(votes).forEach(([voterId, voteValue]) => {
        const chip = document.createElement("div");
        chip.className = "voter-avatar-chip";
        chip.innerText = Net.players[voterId]?.name || "Thành viên";

        if (voteValue === "ACQUIT") { countAcquit++; listAcquit.appendChild(chip); } 
        else if (voteValue === "EXECUTE") { countExecute++; listExecute.appendChild(chip); }
    });

    document.getElementById("count-acquit").innerText = countAcquit;
    document.getElementById("count-execute").innerText = countExecute;

    const progressWrapper = document.getElementById("trial-vote-progress-wrapper");
    if (progressWrapper) {
        progressWrapper.classList.remove("hidden");
        const totalVotes = countAcquit + countExecute;
        const totalAlive = window.G.players.filter(p => p.alive).length;
        
        document.getElementById("trial-vote-ratio").innerText = `${totalVotes}/${totalAlive}`;
        document.getElementById("trial-vote-progress-fill").style.width = `${totalAlive > 0 ? (totalVotes / totalAlive) * 100 : 0}%`;
    }

    // SỬA BUG 12: Chặn Hồn Ma bỏ phiếu trên UI
    const verifyAliveVote = () => {
        const mySelf = Net.players[Net.playerId];
        if (mySelf && !mySelf.alive) {
            showToast("Người chết không có quyền biểu quyết phán quyết!", "danger");
            return false;
        }
        return true;
    };

    document.getElementById("btn-vote-acquit").onclick = () => {
        if (verifyAliveVote()) set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "ACQUIT");
    };

    document.getElementById("btn-vote-execute").onclick = () => {
        if (verifyAliveVote()) set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "EXECUTE");
    };
}

// ==========================================
// 6. HỆ THỐNG KÊNH CHAT (SỬA BUG 3: QUẢN LÝ LISTENER)
// ==========================================
function setupChatEngine() {
    const btnSend = document.getElementById("btn-chat-send");
    const input = document.getElementById("chat-input-field");

    if (btnSend && input) {
        btnSend.addEventListener("click", sendChatMessage);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChatMessage(); });
    }

    const channels = ["chan-public", "chan-wolf", "chan-couple", "chan-prime", "chan-vampire", "chan-reaper", "chan-graveyard"];
    channels.forEach(ch => {
        document.getElementById(ch)?.addEventListener("click", (e) => {
            channels.forEach(c => document.getElementById(c)?.classList.remove("active"));
            e.target.classList.add("active");
            
            const chanName = ch.replace("chan-", "");
            Net.currentChannel = chanName;

            let mappedFirebasePath = chanName;
            const mySelf = Net.players[Net.playerId];

            if (chanName === "couple" && mySelf?.coupleId) mappedFirebasePath = mySelf.coupleId;
            else if (chanName === "prime" && mySelf?.primeCovenantId) mappedFirebasePath = mySelf.primeCovenantId;
            else if (chanName === "vampire" && mySelf?.vampireFactionId) mappedFirebasePath = mySelf.vampireFactionId;
            else if (chanName === "reaper" && mySelf?.reaperFactionId) mappedFirebasePath = mySelf.reaperFactionId;

            listenToChatChannel(mappedFirebasePath);
        });
    });

    // Mặc định load kênh Làng khi vào phòng
    listenToChatChannel("public");
}

async function sendChatMessage() {
    const input = document.getElementById("chat-input-field");
    const msg = input?.value.trim();
    if (!msg) return;

    let mappedFirebasePath = Net.currentChannel;
    const mySelf = Net.players[Net.playerId];

    if (Net.currentChannel === "couple" && mySelf?.coupleId) mappedFirebasePath = mySelf.coupleId;
    else if (Net.currentChannel === "prime" && mySelf?.primeCovenantId) mappedFirebasePath = mySelf.primeCovenantId;
    else if (Net.currentChannel === "vampire" && mySelf?.vampireFactionId) mappedFirebasePath = mySelf.vampireFactionId;
    else if (Net.currentChannel === "reaper" && mySelf?.reaperFactionId) mappedFirebasePath = mySelf.reaperFactionId;

    try {
        await push(ref(db, `rooms/${Net.roomId}/chats/${mappedFirebasePath}`), {
            senderName: Net.playerName, senderId: Net.playerId, text: msg, timestamp: Date.now()
        });
        input.value = "";
    } catch (err) { console.error("Lỗi gửi chat:", err); }
}

function listenToChatChannel(channelPath) {
    // SỬA BUG 3: Chắc chắn dọn rác Listener của Kênh cũ trước khi đăng ký Kênh mới
    if (activeChatUnsub) {
        activeChatUnsub();
        activeChatUnsub = null;
    }

    activeChatUnsub = onValue(ref(db, `rooms/${Net.roomId}/chats/${channelPath}`), (snap) => {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        chatBox.innerHTML = "";

        const messages = snap.val() || {};
        Object.values(messages).forEach(m => {
            const row = document.createElement("div");
            row.className = `chat-msg ${Net.currentChannel}`;
            row.innerHTML = `<b style="color:var(--accent)">${m.senderName}:</b> ${m.text}`;
            chatBox.appendChild(row);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function setupSpectatorWinPoll() {
    ["pred-bar-village", "pred-bar-wolf", "pred-bar-third"].forEach(id => {
        document.getElementById(id)?.addEventListener("click", async () => {
            const mySelf = Net.players[Net.playerId];
            if (mySelf && mySelf.alive) return showToast("Bạn vẫn đang sống, hãy tập trung thảo luận!", "warning");
            await set(ref(db, `rooms/${Net.roomId}/prediction_poll/${Net.playerId}`), id.replace("pred-bar-", ""));
        });
    });

    const unsubPoll = onValue(ref(db, `rooms/${Net.roomId}/prediction_poll`), (snap) => {
        const polls = snap.val() || {};
        const total = Object.keys(polls).length || 1;
        let counts = { village: 0, wolf: 0, third: 0 };
        
        Object.values(polls).forEach(fac => counts[fac]++);

        ["village", "wolf", "third"].forEach(fac => {
            const pct = Math.round((counts[fac] / total) * 100);
            const bar = document.getElementById(`pred-bar-${fac}`);
            const text = document.getElementById(`pred-pct-${fac}`);
            if (bar) bar.style.width = `${pct}%`;
            if (text) text.innerText = `${pct}%`;
        });
    });
    activeUnsubscribers.push(unsubPoll);
}

// ==========================================
// 7. HIỂN THỊ LƯỚI GRID NGƯỜI CHƠI & LỊCH SỬ
// ==========================================
function renderPlayersGridSmartly() {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;

    const currentPlayers = Object.values(Net.players);
    const existingCardsMap = {};

    grid.querySelectorAll(".player-grid-card").forEach(card => {
        const id = card.getAttribute("data-id");
        if (id) existingCardsMap[id] = card;
    });

    currentPlayers.forEach(p => {
        let card = existingCardsMap[p.id];
        if (!card) {
            card = document.createElement("div");
            card.className = "player-grid-card";
            card.setAttribute("data-id", p.id);
            
            const dot = document.createElement("span"); dot.className = "status-dot";
            const name = document.createElement("span"); name.className = "name";
            const roleUnmasked = document.createElement("span"); roleUnmasked.className = "role-unmasked";

            card.append(dot, name, roleUnmasked);
            card.addEventListener("click", () => showPlayerBottomSheet(p, Net.isHost));
            grid.appendChild(card);
        }

        const nameEl = card.querySelector(".name");
        if (nameEl && nameEl.innerText !== p.name) nameEl.innerText = p.name;

        const roleUnmaskedEl = card.querySelector(".role-unmasked");
        if (roleUnmaskedEl) {
            const roleText = Net.isHost ? `[${getRoleName(p.role)}]` : "";
            if (roleUnmaskedEl.innerText !== roleText) roleUnmaskedEl.innerText = roleText;
        }

        const dotEl = card.querySelector(".status-dot");
        if (dotEl) {
            const expectedClass = `status-dot ${p.isConnected ? "online" : "offline"}`;
            if (dotEl.className !== expectedClass) dotEl.className = expectedClass;
        }

        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        card.querySelectorAll(".wolf-votes").forEach(el => el.remove());
        applyDecorativeClasses(p, card);
        delete existingCardsMap[p.id];
    });

    Object.values(existingCardsMap).forEach(card => card.remove());
}

function applyDecorativeClasses(p, card) {
    const buffs = {
        isSeerScanned: "seer-scanned", isProtected: "guard-protected", isGuardBlocked: "guard-blocked",
        isWitchHealed: "witch-healed", isWitchPoisoned: "witch-poisoned", isHunterMarked: "hunter-marked",
        isCupidLinked: "cupid-linked", isAngelPurified: "angel-purified", isCarverBlacklisted: "carver-blacklisted",
        isGuarantorSealed: "guarantor-sealed", isReflectorMirrored: "reflector-mirrored", isAvengerAsleep: "avenger-asleep",
        isAvengerExecuted: "avenger-executed", isWolfTargeted: "wolf-targeted", isSnowWolfFrozen: "snowwolf-frozen",
        isWolfMageScanned: "wolfmage-scanned", isPhantomSwapped: "phantom-swapped", isSilencerMuted: "silencer-muted",
        isSolitaireCursed: "solitaire-cursed", isDemonHellfire: "demon-hellfire", isMissionaryConverted: "missionary-converted",
        isVampireBitten: "vampire-bitten", isArsonistPetroled: "arsonist-petroled", isArsonistIgnited: "arsonist-ignited",
        isEradicatorTrapped: "eradicator-trapped", isManipulatorManipulated: "manipulator-manipulated",
        isLethalSlashed: "lethal-slashed", isReaperPredicted: "reaper-predicted", isPrimeNebula: "prime-nebula",
        isCatClawed: "cat-clawed", isCatSealed: "cat-sealed", isReaperCorpse: "reaper-corpse"
    };

    Object.entries(buffs).forEach(([prop, cls]) => {
        if (p[prop]) card.classList.add(cls);
    });

    if (p.wolfVotesCount && p.wolfVotesCount > 0) {
        const badge = document.createElement("span");
        badge.className = "wolf-votes";
        badge.innerText = `🐺 x${p.wolfVotesCount}`;
        card.appendChild(badge);
    }
}

function renderGMLogs(logs) {
    const logBox = document.getElementById("gm-timeline-log");
    if (!logBox) return;
    logBox.innerHTML = "";

    Object.values(logs).sort((a, b) => b.timestamp - a.timestamp).forEach(l => {
        const item = document.createElement("div");
        item.className = "log-item";
        item.innerHTML = `<span class="sys-msg">[Ngày ${l.day} - ${l.phase.toUpperCase()}]</span> <span class="${l.type}-msg">${l.msg}</span>`;
        logBox.appendChild(item);
    });
}

// ==========================================
// 8. HỆ THỐNG HÒM THƯ (MAILBOX SYSTEM)
// ==========================================
function renderMailbox(mails) {
    const container = document.getElementById("mailbox-list");
    if (!container) return;
    container.innerHTML = "";

    const mailArray = Object.entries(mails).map(([id, data]) => ({ id, ...data })).sort((a, b) => b.timestamp - a.timestamp);
    const unreadCount = mailArray.filter(m => !m.isRead).length;
    
    const badge = document.getElementById("mail-badge");
    if (badge) {
        if (unreadCount > 0) { badge.innerText = unreadCount; badge.classList.remove("hidden"); }
        else badge.classList.add("hidden");
    }

    const filteredMails = mailArray.filter(m => Net.mailCategory === "all" || m.category === Net.mailCategory);
    openedMailsList = filteredMails;

    if (filteredMails.length === 0) {
        container.innerHTML = `<p class="empty-mailbox-hint" style="text-align: center; font-size:13px; opacity:0.5; margin-top:20px;">Hòm thư trống</p>`;
        return;
    }

    filteredMails.forEach((mail, idx) => {
        const card = document.createElement("div");
        card.className = `mail-card ${mail.isRead ? "read" : "unread"}`;
        card.innerHTML = `<div class="mail-title">${mail.title}</div><div class="mail-summary">${mail.content}</div><div class="mail-indicator">${mail.isRead ? "✓" : "!"}</div>`;
        card.addEventListener("click", () => { currentMailIndex = idx; openParchmentMail(mail); });
        container.appendChild(card);
    });
}

function openParchmentMail(mail) {
    const modal = document.getElementById("mailbox-parchment-modal");
    if (!modal) return;

    document.getElementById("parchment-mail-title").innerText = mail.title;
    document.getElementById("parchment-mail-text").innerText = mail.content;
    modal.style.display = "flex";

    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${mail.id}`), { isRead: true });
    document.getElementById("btn-close-parchment").onclick = () => modal.style.display = "none";
}

function setupParchmentNavigation() {
    document.getElementById("btn-prev-parchment")?.addEventListener("click", () => {
        if (currentMailIndex > 0) openParchmentMail(openedMailsList[--currentMailIndex]);
        else showToast("Đây là mật thư đầu tiên!", "info");
    });
    document.getElementById("btn-next-parchment")?.addEventListener("click", () => {
        if (currentMailIndex < openedMailsList.length - 1) openParchmentMail(openedMailsList[++currentMailIndex]);
        else showToast("Đây là mật thư cuối cùng!", "info");
    });
}

function setupMailboxCategoryFilters() {
    const tabs = document.querySelectorAll(".mail-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            Net.mailCategory = tab.getAttribute("data-category");
            get(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`)).then((snap) => renderMailbox(snap.val() || {}));
        });
    });

    document.getElementById("btn-mail-read-all")?.addEventListener("click", async () => {
        try {
            const snap = await get(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`));
            if (snap.exists()) {
                const updates = {};
                Object.keys(snap.val()).forEach(id => updates[`rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${id}/isRead`] = true);
                await update(ref(db), updates);
                showToast("Đã đánh dấu đã đọc toàn bộ mật thư!", "success");
            }
        } catch (err) { console.error(err); }
    });
}

// ==========================================
// 9. CÁC TIỆN ÍCH HOẠT ĐỘNG KHÁC
// ==========================================
function copyRoomId() {
    if (!Net.roomId) return;
    navigator.clipboard.writeText(Net.roomId).then(() => showToast("Đã sao chép mã phòng vào khay nhớ tạm!", "success"));
}

function updateBalanceAndCountsUI() {
    if (!window.G) return;
    const totalRoleAllocated = Object.values(window.G.roleCounts).reduce((a, b) => a + b, 0);
    const roleCountEl = document.getElementById("role-count");
    const totalEl = document.getElementById("role-player-total");
    
    if (roleCountEl) roleCountEl.innerText = totalRoleAllocated;
    if (totalEl) totalEl.innerText = window.G.players.length;

    const pCountDisp = document.getElementById('player-count-display');
    if (pCountDisp) pCountDisp.innerText = window.G.players.length;

    window.UI_Module.updateBalanceUI();
    window.UI_Module.updateActiveRolesSummary();
}

async function toggleReadyState() {
    const mySelf = Net.players[Net.playerId];
    if (!mySelf) return;
    try { await update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}`), { isReady: !mySelf.isReady }); } 
    catch (err) { console.error("Lỗi thay đổi trạng thái sẵn sàng:", err); }
}

async function hostStartSetup() {
    if (!Net.isHost) return;
    try {
        await update(ref(db, `rooms/${Net.roomId}/meta`), { phase: "day", day: 0 });
        showToast("Thiết lập phòng hoàn tất! Hãy tiến hành phân phát vai trò.", "success");
    } catch (err) { console.error("Lỗi đồng bộ hóa GM bắt đầu:", err); }
}