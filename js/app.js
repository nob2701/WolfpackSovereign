import { 
    db, ref, set, get, onValue, update, push, remove, child, onDisconnect, runTransaction 
} from "./firebase-config.js";
import { StateMachine } from "./state-machine.js";
import { 
    openTargetSelection, ModalManager, initMobileTabSync, showPlayerBottomSheet, setupSoundSettings 
} from "./ui-manager.js";
import { ROLE_DB, ROLE_ICONS, FACTION_ICONS, getRoleName } from "./game-logic.js";

// Trạng thái mạng và đồng bộ cục bộ của Client
export const Net = {
    roomId: null,
    playerId: null,
    playerName: "",
    isHost: false,
    players: {}, 
    connectedRef: null,
    currentChannel: "public",
    mailCategory: "all"
};

// Khởi tạo ứng dụng khi DOM tải xong
document.addEventListener("DOMContentLoaded", () => {
    initLobbyEngine();
    setupCodeInputNavigation();
    initMobileTabSync();
    setupSoundSettings();
    setupChatEngine();
    setupSpectatorWinPoll();
    setupMailboxCategoryFilters();
    dismissSplashScreen();
});

// Gỡ bỏ màn hình chờ
function dismissSplashScreen() {
    const splash = document.getElementById("splash-screen");
    if (splash) {
        const dismiss = () => {
            splash.classList.add("hidden");
        };
        splash.addEventListener("click", dismiss);
        setTimeout(dismiss, 1500);
    }
}

// ==========================================
// 1. LUỒNG ĐĂNG KÝ VÀ KIỂM TRA ĐẦU VÀO (LOGIN ENGINE)
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

    // Khôi phục tên cũ nếu đã lưu
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

    // Sự kiện chuyển hướng giữa đăng nhập và nhập mã phòng
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

    // Chuyển tab cấu hình subpanel phía bên phải (Dành cho PC)
    document.getElementById("tab-btn-chat")?.addEventListener("click", () => switchRightSubPanel("chat"));
    document.getElementById("tab-btn-roles-config")?.addEventListener("click", () => switchRightSubPanel("config"));
}

// Logic dịch chuyển con trỏ tự động 6 ô nhập mã phòng
function setupCodeInputNavigation() {
    const inputs = document.querySelectorAll(".code-input");
    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (input.value && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
            checkCodeComplete();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

function checkCodeComplete() {
    const inputs = document.querySelectorAll(".code-input");
    let code = "";
    inputs.forEach(i => code += i.value);
    const btnJoinSubmit = document.getElementById("btn-join-room-submit");
    if (btnJoinSubmit) {
        btnJoinSubmit.disabled = code.length !== 6;
    }
}

// ==========================================
// 2. KẾT NỐI: TẠO PHÒNG VÀ ĐỒNG BỘ TRẠNG THÁI CHỜ
// ==========================================
async function createRoom() {
    if (Net.playerName.length < 2) return;
    const roomId = generateRoomCode();
    Net.roomId = roomId;
    Net.playerId = "host_" + Date.now();
    Net.isHost = true;

    const roomRef = ref(db, `rooms/${roomId}`);
    const hostData = {
        id: Net.playerId,
        name: Net.playerName,
        isHost: true,
        isReady: true,
        isConnected: true,
        alive: true,
        role: "villager",
        realFaction: "villager",
        turnEnded: false
    };

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
        alert("Lỗi khi kết nối máy chủ để khởi tạo phòng!");
    }
}

function joinRoomFromInputs() {
    const inputs = document.querySelectorAll(".code-input");
    let code = "";
    inputs.forEach(i => code += i.value);
    
    if (code.length === 6) {
        joinRoom(code, Net.playerName);
    }
}

async function joinRoom(roomId, name) {
    const roomRef = ref(db, `rooms/${roomId}`);
    try {
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            alert("Mã phòng không tồn tại!");
            return;
        }

        const roomData = snapshot.val();
        if (roomData.meta.started) {
            alert("Ván đấu trong phòng đã bắt đầu, không thể tham gia!");
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
            isReady: false,
            isConnected: true,
            alive: true,
            role: "villager",
            realFaction: "villager",
            turnEnded: false
        };

        await set(playerRef, playerData);
        enterLobbyMode();
        listenToRoom();
    } catch (error) {
        alert("Gặp sự cố khi gia nhập phòng trực tuyến!");
    }
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

    setupPresenceSystem();
}

function setupPresenceSystem() {
    const playerOnlineRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isConnected`);
    const myPresenceRef = ref(db, `.info/connected`);

    onValue(myPresenceRef, (snap) => {
        if (snap.val() === true) {
            onDisconnect(playerOnlineRef).set(false);
            set(playerOnlineRef, true);
        }
    });
}

async function toggleReadyState() {
    if (Net.isHost) return;
    const selfPlayerRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/isReady`);
    try {
        const snapshot = await get(selfPlayerRef);
        const currentReady = snapshot.exists() ? snapshot.val() : false;
        await set(selfPlayerRef, !currentReady);

        const btn = document.getElementById("btn-player-toggle-ready");
        if (currentReady) {
            btn.innerText = "ĐÃ SẴN SÀNG (READY!)";
            btn.className = "btn-success w-100";
        } else {
            btn.innerText = "HỦY SẴN SÀNG (READYING...)";
            btn.className = "btn-danger w-100";
        }
    } catch (error) {
        console.error("Lỗi thay đổi trạng thái sẵn sàng:", error);
    }
}

// ==========================================
// 3. ĐỒNG BỘ TRẬN ĐẤU & THIẾT LẬP BẢN ĐỒ VAI TRÒ CHƠI
// ==========================================
function listenToRoom() {
    const roomRef = ref(db, `rooms/${Net.roomId}`);
    onValue(roomRef, (snapshot) => {
        if (!snapshot.exists()) {
            handleRoomTerminated();
            return;
        }

        const data = snapshot.val();
        Net.players = data.players || {};

        // Cập nhật danh sách phòng chờ
        updateLobbyPlayersUI();

        // Kiểm tra điều kiện bắt đầu game (Quản trò kiểm soát)
        if (Net.isHost) {
            const nonHostPlayers = Object.values(Net.players).filter(p => !p.isHost && p.isConnected);
            const allReady = nonHostPlayers.length > 0 && nonHostPlayers.every(p => p.isReady === true);
            document.getElementById("btn-host-start-setup").disabled = !allReady;
        }

        // Đồng bộ chuyển cảnh bắt đầu trận đấu
        if (data.meta.started && document.body.getAttribute("data-view") === "lobby") {
            transitionToGameScreen(data);
        }

        if (data.meta.started) {
            syncGameStateWithEngine(data);
            syncLayoutBasedOnRoleAndStatus(data);
            syncTrialPhases(data);

            // Host tự động lắng nghe để chuyển pha ngày khi tất cả xác nhận kết thúc lượt
            if (Net.isHost && data.meta.phase === "night") {
                StateMachine.checkAndAutoTransitionToDay();
            }
        }
    });
}

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
        }
    });

    if (connectedCount) connectedCount.innerText = count;
}

function transitionToGameScreen(roomData) {
    document.body.setAttribute("data-view", "game");
    document.getElementById("lobby-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");

    // Phân tab cấu hình vai trò của GM
    const tabConfigBtn = document.getElementById("tab-btn-roles-config");
    if (Net.isHost) {
        tabConfigBtn.classList.remove("hidden");
        document.getElementById("gm-timeline-container").classList.remove("hidden");
        document.getElementById("player-mailbox-container").classList.add("hidden");
    } else {
        tabConfigBtn.classList.add("hidden");
        document.getElementById("gm-timeline-container").classList.add("hidden");
        document.getElementById("player-mailbox-container").classList.remove("hidden");
    }

    // Kích hoạt hiển thị lật thẻ nhận vai trò an toàn nếu là dân thường
    if (!Net.isHost) {
        triggerCardFlipModal(Net.players[Net.playerId]);
        listenToMailbox();
    }
}

// BỘ LẬT THẺ NHẬN BẢN ÁN VAI TRÒ BẢO MẬT (CARD FLIP OVERLAY)
function triggerCardFlipModal(mySelf) {
    if (!mySelf) return;

    const modal = document.getElementById("flashcard-modal");
    const card = document.getElementById("fc-card");
    const pName = document.getElementById("fc-player-name");
    const rName = document.getElementById("fc-role-name");
    const rDesc = document.getElementById("fc-role-desc");

    if (!modal || !card || !pName || !rName || !rDesc) return;

    pName.innerText = mySelf.name;
    rName.innerText = getRoleName(mySelf.role);
    rDesc.innerText = `Lực lượng thuộc phe: ${ROLE_DB[mySelf.role]?.faction?.toUpperCase()}. Bạn hãy bấm để mở ra và ghi nhớ kỹ năng bí mật của mình.`;
    
    // Gỡ bỏ class cũ nếu có
    card.classList.remove("is-flipped");
    modal.style.display = "flex";

    const flipCard = () => {
        card.classList.add("is-flipped");
    };

    const closeCard = (e) => {
        e.stopPropagation();
        modal.style.display = "none";
        card.removeEventListener("click", flipCard);
        document.getElementById("fc-card").removeEventListener("click", closeCard);
    };

    card.addEventListener("click", flipCard);
    
    // Chạm mặt sau để tắt
    const backFace = card.querySelector(".fc-back");
    if (backFace) {
        backFace.addEventListener("click", closeCard);
    }
}

function syncLayoutBasedOnRoleAndStatus(roomData) {
    const mySelf = Net.players[Net.playerId];
    
    // Xử lý chế độ Linh hồn (Spectator & Graveyard Mode)
    if (mySelf && !mySelf.alive) {
        document.body.classList.add("ghostly-mist-active");
        document.getElementById("chan-graveyard")?.classList.remove("hidden");
        document.getElementById("spectator-prediction-widget")?.classList.remove("hidden");
        renderUnmaskedSpectatorGrid();
    } else {
        document.body.classList.remove("ghostly-mist-active");
        document.getElementById("chan-graveyard")?.classList.add("hidden");
        document.getElementById("spectator-prediction-widget")?.classList.add("hidden");
        renderNormalPlayerGrid();
    }

    // Đồng bộ kênh chat đêm tương thích với Faction
    if (mySelf && mySelf.alive) {
        if (mySelf.role === "wolf" || mySelf.realFaction === "wolf") {
            document.getElementById("chan-wolf")?.classList.remove("hidden");
        } else {
            document.getElementById("chan-wolf")?.classList.add("hidden");
        }
        
        if (mySelf.inCouple) {
            document.getElementById("chan-couple")?.classList.remove("hidden");
        } else {
            document.getElementById("chan-couple")?.classList.add("hidden");
        }
    }

    // Đồng bộ bảng điều khiển động dưới cùng cho người chơi sử dụng kỹ năng đêm
    renderDynamicActionControls(roomData, mySelf);
}

// Khởi tạo bảng nút điều khiển kỹ năng đêm hoặc bỏ phiếu ngày của người chơi
function renderDynamicActionControls(roomData, mySelf) {
    const controlPanel = document.getElementById("controls");
    if (!controlPanel || !mySelf) return;

    const phase = roomData.meta?.phase || "setup";

    if (phase === "night") {
        if (!mySelf.alive) {
            controlPanel.innerHTML = `<p style="color:var(--log-text); font-style:italic;">Bạn đã gục ngã. Đang theo dõi ván đấu dưới dạng linh hồn...</p>`;
            return;
        }

        // Nếu đã nhấn nút "Xác nhận kết thúc lượt" đêm nay
        if (mySelf.turnEnded) {
            controlPanel.innerHTML = `<p style="color:var(--success); font-weight:bold; animation: blinker 1.5s infinite;">Đã xác nhận kết thúc lượt! Đang ngủ say chờ làng dậy...</p>`;
            return;
        }

        // Kiểm tra xem vai trò có kỹ năng kích hoạt đêm không (Villager thường không có)
        const hasSkill = mySelf.role !== "villager";
        const rIcon = ROLE_ICONS[mySelf.role] || "🔮";

        let buttonHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                ${hasSkill ? `<button id="btn-use-skill" class="btn-accent w-100">${rIcon} KÍCH HOẠT KỸ NĂNG ĐÊM</button>` : `<p style="color:var(--log-text);">Bạn là Dân Làng bình thường. Đang ngủ say...</p>`}
                <button id="btn-end-turn" class="btn-success w-100">💤 XÁC NHẬN KẾT THÚC LƯỢT</button>
            </div>
        `;

        controlPanel.innerHTML = buttonHTML;

        // Xử lý mở bảng chọn mục tiêu động tương ứng với vai trò
        document.getElementById("btn-use-skill")?.addEventListener("click", () => {
            openTargetSelection(Object.values(Net.players), mySelf.role, (targetPlayerId, secondaryId, chosenModifier, phrase) => {
                // Đẩy mục tiêu chọn lên Firebase
                set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/targetSelection`), {
                    actionType: chosenModifier || (mySelf.role + "_action"), 
                    targetId: targetPlayerId,
                    secondaryId: secondaryId,
                    phrase: phrase,
                    timestamp: Date.now()
                });
                alert("Đã ghi nhận mục tiêu hành động đêm của bạn!");
            });
        });

        // Xử lý xác nhận kết thúc lượt (Đi ngủ hoàn tất)
        document.getElementById("btn-end-turn")?.addEventListener("click", async () => {
            try {
                await set(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/turnEnded`), true);
            } catch (err) {
                console.error("Lỗi xác nhận kết thúc lượt:", err);
            }
        });

    } else if (phase === "day") {
        // Pha thảo luận ban ngày: Hiển thị nút đề cử treo cổ tự do
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
// 4. HỆ THỐNG BIỂU QUYẾT 4 BƯỚC (TRIAL STEPS ENGINE)
// ==========================================
function syncTrialPhases(roomData) {
    const trial = roomData.trial || { stage: "none", accusedId: null };
    const stageContainer = document.getElementById("trial-stage-container");

    // Xóa kích hoạt tất cả chỉ số bước
    const steps = ["step-ind-1", "step-ind-2", "step-ind-3", "step-ind-4"];
    steps.forEach(st => document.getElementById(st)?.classList.remove("active"));

    if (trial.stage === "none") {
        stageContainer.classList.add("hidden");
        document.getElementById("vote-modal").style.display = "none";
        return;
    }

    stageContainer.classList.remove("hidden");

    // BƯỚC 1: TỐ GIÁC
    if (trial.stage === "nomination") {
        document.getElementById("step-ind-1").classList.add("active");
    }

    // BƯỚC 2: BIỆN HỘ
    if (trial.stage === "defense") {
        document.getElementById("step-ind-2").classList.add("active");
        const accusedName = Net.players[trial.accusedId]?.name || "Bị cáo";
        
        if (Net.playerId === trial.accusedId) {
            renderDefenseTypingPanel(true);
        } else {
            renderDefenseTypingPanel(false, accusedName);
        }
    }

    // BƯỚC 3: PHÁN QUYẾT
    if (trial.stage === "vote") {
        document.getElementById("step-ind-3").classList.add("active");
        openSplitScreenVoteModal(trial.accusedId);
    }

    // BƯỚC 4: DI NGÔN / PHÁN QUYẾT CHUNG CUỘC
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
        area.addEventListener("input", () => {
            update(ref(db, `rooms/${Net.roomId}/trial`), {
                accusedText: area.value
            });
        });

        document.getElementById("btn-submit-defense-speech")?.addEventListener("click", () => {
            update(ref(db, `rooms/${Net.roomId}/trial`), {
                stage: "vote"
            });
        });
    } else {
        controlPanel.innerHTML = `
            <div style="background:var(--bg-item); padding:15px; border-radius:10px; text-align:left; min-height:80px; border-left:4px solid gold;">
                <p id="defense-realtime-display" style="font-style:italic; margin:0; color:gold;">Bị cáo đang soạn thảo lời bào chữa...</p>
            </div>
        `;
        
        onValue(ref(db, `rooms/${Net.roomId}/trial/accusedText`), (snap) => {
            const txt = snap.val() || "...";
            const display = document.getElementById("defense-realtime-display");
            if (display) display.innerText = `"${txt}"`;
        });
    }
}

function openSplitScreenVoteModal(accusedId) {
    const modal = document.getElementById("vote-modal");
    if (!modal) return;
    modal.style.display = "flex";

    const title = document.getElementById("vote-modal-title");
    title.innerText = `PHÁN QUYẾT SỐ PHẬN: ${Net.players[accusedId]?.name?.toUpperCase()}`;

    const listAcquit = document.getElementById("list-voters-acquit");
    const listExecute = document.getElementById("list-voters-execute");
    listAcquit.innerHTML = "";
    listExecute.innerHTML = "";

    onValue(ref(db, `rooms/${Net.roomId}/votes`), (snap) => {
        const votes = snap.val() || {};
        listAcquit.innerHTML = "";
        listExecute.innerHTML = "";
        
        let countAcquit = 0;
        let countExecute = 0;

        Object.entries(votes).forEach(([voterId, voteValue]) => {
            const voterName = Net.players[voterId]?.name || "Thành viên";
            const chip = document.createElement("div");
            chip.className = "voter-avatar-chip";
            chip.innerText = voterName;

            if (voteValue === "ACQUIT") {
                countAcquit++;
                listAcquit.appendChild(chip);
            } else if (voteValue === "EXECUTE") {
                countExecute++;
                listExecute.appendChild(chip);
            }
        });

        document.getElementById("count-acquit").innerText = countAcquit;
        document.getElementById("count-execute").innerText = countExecute;
    });

    document.getElementById("btn-vote-acquit")?.addEventListener("click", () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "ACQUIT");
    });

    document.getElementById("btn-vote-execute")?.addEventListener("click", () => {
        set(ref(db, `rooms/${Net.roomId}/votes/${Net.playerId}`), "EXECUTE");
    });
}

// Hoạt ảnh búa tòa án đập (Gavel Strike Animation)
export function runGavelStrikeAnimation(decisionText, callback) {
    const overlay = document.getElementById("gavel-animation-overlay");
    const flash = document.getElementById("gavel-flash-element");
    const announcement = document.getElementById("gavel-verdict-announcement");

    if (!overlay) return;

    announcement.innerText = decisionText;
    overlay.classList.remove("hidden");

    // Kích hoạt chớp sáng va chạm
    setTimeout(() => {
        if (flash) flash.classList.add("flash-active");
    }, 500);

    // Dọn dẹp hoạt ảnh sau 2.5 giây
    setTimeout(() => {
        overlay.classList.add("hidden");
        if (flash) flash.classList.remove("flash-active");
        if (callback) callback();
    }, 2500);
}

// ==========================================
// 5. HỆ THỐNG HÒM THƯ MAILBOX & LÁ BÀI DA
// ==========================================
export function listenToMailbox() {
    const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
    onValue(mailboxRef, (snap) => {
        const mails = snap.val() || {};
        renderMailbox(mails);
    });
}

function renderMailbox(mails) {
    const container = document.getElementById("mailbox-list");
    if (!container) return;
    container.innerHTML = "";

    const mailArray = Object.entries(mails).map(([id, data]) => ({ id, ...data }));
    
    // Sắp xếp thư mới lên đầu
    mailArray.sort((a, b) => b.timestamp - a.timestamp);

    // Lọc theo Category chọn
    const filteredMails = mailArray.filter(m => {
        if (Net.mailCategory === "all") return true;
        return m.category === Net.mailCategory;
    });

    if (filteredMails.length === 0) {
        container.innerHTML = `<p class="empty-mailbox-hint" style="text-align: center; font-size:13px; opacity:0.5; margin-top:20px;">Hòm thư trống</p>`;
        return;
    }

    filteredMails.forEach(mail => {
        const card = document.createElement("div");
        card.className = `mail-card ${mail.isRead ? "read" : "unread"}`;
        
        const title = document.createElement("div");
        title.className = "mail-title";
        title.innerText = mail.title;

        const summary = document.createElement("div");
        summary.className = "mail-summary";
        summary.innerText = mail.content;

        const indicator = document.createElement("div");
        indicator.className = "mail-indicator";
        indicator.innerText = mail.isRead ? "✓" : "!";

        card.appendChild(title);
        card.appendChild(summary);
        card.appendChild(indicator);

        card.addEventListener("click", () => openParchmentMail(mail));
        container.appendChild(card);
    });
}

function openParchmentMail(mail) {
    const modal = document.getElementById("mailbox-parchment-modal");
    const pTitle = document.getElementById("parchment-mail-title");
    const pText = document.getElementById("parchment-mail-text");

    if (!modal || !pTitle || !pText) return;

    pTitle.innerText = mail.title;
    pText.innerText = mail.content;
    modal.style.display = "flex";

    // Đồng bộ trạng thái đã đọc lên Firebase
    update(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${mail.id}`), {
        isRead: true
    });

    document.getElementById("btn-close-parchment")?.addEventListener("click", () => {
        modal.style.display = "none";
    });
}

function setupMailboxCategoryFilters() {
    const tabs = document.querySelectorAll(".mail-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            Net.mailCategory = tab.getAttribute("data-category");
            
            // Re-fetch và render lại
            get(ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`)).then((snap) => {
                renderMailbox(snap.val() || {});
            });
        });
    });

    // Sự kiện Đọc tất cả thư nhanh
    document.getElementById("btn-mail-read-all")?.addEventListener("click", async () => {
        const mailboxRef = ref(db, `rooms/${Net.roomId}/players/${Net.playerId}/mailbox`);
        try {
            const snap = await get(mailboxRef);
            if (snap.exists()) {
                const mails = snap.val();
                const updates = {};
                Object.keys(mails).forEach(id => {
                    updates[`rooms/${Net.roomId}/players/${Net.playerId}/mailbox/${id}/isRead`] = true;
                });
                await update(ref(db), updates);
            }
        } catch (err) {
            console.error(err);
        }
    });
}

// ==========================================
// 6. KHÁN GIẢ & CHAT BẢO MẬT ĐÊM
// ==========================================
function setupChatEngine() {
    const btnSend = document.getElementById("btn-chat-send");
    const input = document.getElementById("chat-input-field");

    if (btnSend && input) {
        btnSend.addEventListener("click", sendChatMessage);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") sendChatMessage();
        });
    }

    // Chuyển kênh chat thời gian thực
    const channels = ["chan-public", "chan-wolf", "chan-couple", "chan-graveyard"];
    channels.forEach(ch => {
        document.getElementById(ch)?.addEventListener("click", (e) => {
            channels.forEach(c => document.getElementById(c).classList.remove("active"));
            e.target.classList.add("active");
            
            const chanName = ch.replace("chan-", "");
            Net.currentChannel = chanName;
            listenToChatChannel(chanName);
        });
    });
}

async function sendChatMessage() {
    const input = document.getElementById("chat-input-field");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${Net.currentChannel}`);
    const messagePayload = {
        senderName: Net.playerName,
        senderId: Net.playerId,
        text: msg,
        timestamp: Date.now()
    };

    try {
        await push(chatRef, messagePayload);
        input.value = "";
    } catch (err) {
        console.error("Lỗi gửi chat:", err);
    }
}

function listenToChatChannel(channelName) {
    const chatRef = ref(db, `rooms/${Net.roomId}/chats/${channelName}`);
    onValue(chatRef, (snap) => {
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        chatBox.innerHTML = "";

        const messages = snap.val() || {};
        Object.values(messages).forEach(m => {
            const row = document.createElement("div");
            row.className = `chat-msg ${channelName}`;
            row.innerHTML = `<b style="color:var(--accent)">${m.senderName}:</b> ${m.text}`;
            chatBox.appendChild(row);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

function setupSpectatorWinPoll() {
    const buttons = [
        { id: "pred-bar-village", faction: "village" },
        { id: "pred-bar-wolf", faction: "wolf" },
        { id: "pred-bar-third", faction: "third" }
    ];

    buttons.forEach(btn => {
        document.getElementById(btn.id)?.addEventListener("click", async () => {
            const mySelf = Net.players[Net.playerId];
            if (mySelf && mySelf.alive) {
                alert("Bạn còn sống, không thể tham gia dự đoán!");
                return;
            }
            await set(ref(db, `rooms/${Net.roomId}/prediction_poll/${Net.playerId}`), btn.faction);
        });
    });

    onValue(ref(db, `rooms/${Net.roomId}/prediction_poll`), (snap) => {
        const polls = snap.val() || {};
        const total = Object.keys(polls).length || 1;
        let counts = { village: 0, wolf: 0, third: 0 };
        
        Object.values(polls).forEach(fac => counts[fac]++);

        const vilPct = Math.round((counts.village / total) * 100);
        const wolfPct = Math.round((counts.wolf / total) * 100);
        const thirdPct = Math.round((counts.third / total) * 100);

        document.getElementById("pred-bar-village").style.width = `${vilPct}%`;
        document.getElementById("pred-pct-village").innerText = `${vilPct}%`;

        document.getElementById("pred-bar-wolf").style.width = `${wolfPct}%`;
        document.getElementById("pred-pct-wolf").innerText = `${wolfPct}%`;

        document.getElementById("pred-bar-third").style.width = `${thirdPct}%`;
        document.getElementById("pred-pct-third").innerText = `${thirdPct}%`;
    });
}

// ==========================================
// 7. HIỂN THỊ LƯỚI GRID NGƯỜI CHƠI (PLAYER GRID RENDERERS)
// Đồng bộ toàn bộ các lớp trang trí đặc trưng của nâng cấp vai trò mới
// ==========================================
function applyDecorativeClasses(p, card) {
    if (p.isSeerScanned) card.classList.add("seer-scanned");
    if (p.isProtected) card.classList.add("guard-protected");
    if (p.isGuardBlocked) card.classList.add("guard-blocked");
    if (p.isWitchHealed) card.classList.add("witch-healed");
    if (p.isWitchPoisoned) card.classList.add("witch-poisoned");
    if (p.isHunterMarked) card.classList.add("hunter-marked");
    if (p.isCupidLinked) card.classList.add("cupid-linked");
    if (p.isAngelPurified) card.classList.add("angel-purified");
    if (p.isCarverBlacklisted) card.classList.add("carver-blacklisted");
    if (p.isGuarantorSealed) card.classList.add("guarantor-sealed");
    if (p.isReflectorMirrored) card.classList.add("reflector-mirrored");
    if (p.isAvengerAsleep) card.classList.add("avenger-asleep");
    if (p.isAvengerExecuted) card.classList.add("avenger-executed");
    if (p.isWolfTargeted) card.classList.add("wolf-targeted");
    if (p.isSnowWolfFrozen) card.classList.add("snowwolf-frozen");
    if (p.isWolfMageScanned) card.classList.add("wolfmage-scanned");
    if (p.isPhantomSwapped) card.classList.add("phantom-swapped");
    if (p.isSilencerMuted) card.classList.add("silencer-muted");
    if (p.isSolitaireCursed) card.classList.add("solitaire-cursed");
    if (p.isDemonHellfire) card.classList.add("demon-hellfire");
    if (p.isMissionaryConverted) card.classList.add("missionary-converted");
    if (p.isVampireBitten) card.classList.add("vampire-bitten");
    if (p.isArsonistPetroled) card.classList.add("arsonist-petroled");
    if (p.isArsonistIgnited) card.classList.add("arsonist-ignited");
    if (p.isEradicatorTrapped) card.classList.add("eradicator-trapped");
    if (p.isManipulatorManipulated) card.classList.add("manipulator-manipulated");
    if (p.isLethalSlashed) card.classList.add("lethal-slashed");
    if (p.isReaperPredicted) card.classList.add("reaper-predicted");
    if (p.isPrimeNebula) card.classList.add("prime-nebula");
    if (p.isCatClawed) card.classList.add("cat-clawed");
    if (p.isCatSealed) card.classList.add("cat-sealed");
    if (p.isReaperCorpse) card.classList.add("reaper-corpse");

    // Hiển thị phiếu bầu của Sói nếu có dữ liệu
    if (p.wolfVotesCount && p.wolfVotesCount > 0) {
        const badge = document.createElement("span");
        badge.className = "wolf-votes";
        badge.innerText = `🐺 x${p.wolfVotesCount}`;
        card.appendChild(badge);
    }
}

function renderUnmaskedSpectatorGrid() {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.values(Net.players).forEach(p => {
        const card = document.createElement("div");
        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        
        const dot = document.createElement("span");
        dot.className = `status-dot ${p.isConnected ? "online" : "offline"}`;
        
        const name = document.createElement("span");
        name.className = "name";
        name.innerText = p.name;

        const roleUnmasked = document.createElement("span");
        roleUnmasked.className = "role-unmasked";
        roleUnmasked.innerText = p.alive ? `👁️ (${getRoleName(p.role)})` : `(${getRoleName(p.role)})`;
        
        card.appendChild(dot);
        card.appendChild(name);
        card.appendChild(roleUnmasked);

        // Áp dụng phong cách trang trí tùy biến vai trò
        applyDecorativeClasses(p, card);

        // Chạm để xem lý lịch chi tiết bottom-sheet
        card.addEventListener("click", () => {
            showPlayerBottomSheet(p, Net.isHost);
        });

        grid.appendChild(card);
    });
}

function renderNormalPlayerGrid() {
    const grid = document.getElementById("game-players-grid");
    if (!grid) return;
    grid.innerHTML = "";

    Object.values(Net.players).forEach(p => {
        const card = document.createElement("div");
        card.className = `player-grid-card ${p.alive ? "" : "dead"}`;
        
        const dot = document.createElement("span");
        dot.className = `status-dot ${p.isConnected ? "online" : "offline"}`;
        
        const name = document.createElement("span");
        name.className = "name";
        name.innerText = p.name;

        card.appendChild(dot);
        card.appendChild(name);

        // Áp dụng phong cách trang trí tùy biến vai trò
        applyDecorativeClasses(p, card);

        card.addEventListener("click", () => {
            showPlayerBottomSheet(p, Net.isHost);
        });

        grid.appendChild(card);
    });
}

// ==========================================
// 8. TIỆN ÍCH PHỤ TRỢ (UTILITIES)
// ==========================================
function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function copyRoomId() {
    if (!Net.roomId) return;
    navigator.clipboard.writeText(Net.roomId).then(() => {
        alert("Đã sao chép mã phòng vào khay nhớ tạm!");
    });
}

function switchRightSubPanel(target) {
    const chatPanel = document.getElementById("chat-subpanel");
    const rolesPanel = document.getElementById("roles-config-panel-wrapper");
    const tabChat = document.getElementById("tab-btn-chat");
    const tabConfig = document.getElementById("tab-btn-roles-config");

    if (target === "chat") {
        chatPanel?.classList.remove("hidden");
        rolesPanel?.classList.add("hidden");
        tabChat?.classList.add("active");
        tabConfig?.classList.remove("active");
    } else {
        chatPanel?.classList.add("hidden");
        rolesPanel?.classList.remove("hidden");
        tabChat?.classList.remove("active");
        tabConfig?.classList.add("active");
    }
}

function hostStartSetup() {
    if (!Net.isHost) return;
    update(ref(db, `rooms/${Net.roomId}/meta`), {
        phase: "setup",
        started: true
    });
}

function handleRoomTerminated() {
    alert("Phòng chơi đã giải tán hoặc không tìm thấy dữ liệu đồng bộ trên máy chủ!");
    location.reload();
}

function syncGameStateWithEngine(roomData) {
    if (!window.G) return;
    window.G.day = roomData.meta.day || 0;
    window.G.phase = roomData.meta.phase || "setup";
    window.G.players = Object.values(roomData.players || {});
    window.G.roleCounts = roomData.roleCounts || {}; 

    // Nếu là Quản trò, cập nhật giao diện cấu hình trực quan khi có thay đổi dữ liệu
    if (Net.isHost) {
        window.UI_Module.renderRoleConfigPage();
        window.UI_Module.updateBalanceUI();
        window.UI_Module.updateActiveRolesSummary();
        
        const totalRoleAllocated = Object.values(window.G.roleCounts).reduce((a, b) => a + b, 0);
        const roleCountEl = document.getElementById("role-count");
        const totalEl = document.getElementById("role-player-total");
        if (roleCountEl) roleCountEl.innerText = totalRoleAllocated;
        if (totalEl) totalEl.innerText = window.G.players.length;
    }
    
    // Kích hoạt Mailbox Listener ngay khi bắt đầu chơi
    if (!Net.isHost && window.G.phase !== "setup") {
        listenToMailbox();
    }
}