import { Net } from "./app.js";

// ==========================================
// 1. QUẢN LÝ TRÌNH TỰ MODALS (MODAL QUEUE MANAGER)
// Tránh lỗi hiển thị đè đúp Modals (Modal View Collision)
// ==========================================
export const ModalManager = {
    currentModalId: null,
    modalHistory: [],

    // Mở Modal mới và đẩy Modal cũ vào bộ nhớ đệm
    open(modalId) {
        if (this.currentModalId === modalId) return;

        // Nếu đang có Modal mở, ẩn tạm thời và đẩy vào lịch sử
        if (this.currentModalId) {
            const el = document.getElementById(this.currentModalId);
            if (el) el.style.display = "none";
            this.modalHistory.push(this.currentModalId);
        }

        // Kích hoạt hiển thị Modal mới
        const newEl = document.getElementById(modalId);
        if (newEl) {
            newEl.style.display = "flex";
            this.currentModalId = modalId;
        }
    },

    // Đóng Modal hiện tại và khôi phục Modal trước đó nếu có
    closeCurrent() {
        if (!this.currentModalId) return;

        const el = document.getElementById(this.currentModalId);
        if (el) el.style.display = "none";

        if (this.modalHistory.length > 0) {
            const prevId = this.modalHistory.pop();
            const prevEl = document.getElementById(prevId);
            if (prevEl) prevEl.style.display = "flex";
            this.currentModalId = prevId;
        } else {
            this.currentModalId = null;
        }
    },

    // Đóng toàn bộ các Modals lập tức
    closeAll() {
        const modals = document.querySelectorAll(".custom-modal-overlay");
        modals.forEach(m => m.style.display = "none");
        this.currentModalId = null;
        this.modalHistory = [];
    }
};

// ==========================================
// 2. KHỞI TẠO BẢNG CHỌN MỤC TIÊU ĐỘNG (DYNAMIC TARGET GRID)
// Hỗ trợ bổ trợ kỹ năng, đa mục tiêu (Cupid, Sói Ảo Ảnh) và nhại tiếng (Vẹt)
// ==========================================
export function openTargetSelection(playersList, role, onConfirmCallback) {
    const grid = document.getElementById("target-grid-container");
    const modifiersBox = document.getElementById("target-action-modifiers");
    const textInputBox = document.getElementById("target-text-input-container");
    const instruction = document.getElementById("target-modal-instruction");
    
    if (!grid || !modifiersBox || !textInputBox || !instruction) return;

    // Reset trạng thái ban đầu của Modal
    grid.innerHTML = "";
    modifiersBox.innerHTML = "";
    modifiersBox.classList.add("hidden");
    textInputBox.classList.add("hidden");
    instruction.style.display = "none";

    let selectedPlayerIds = [];
    let chosenModifier = null;
    let extraPhrase = "";

    // 2.1 Cấu hình Đa Mục Tiêu (Chọn tối đa 2 đối tượng cùng lúc)
    const multiTargetRoles = ["cupid", "phantomWolf", "eradicator", "manipulator", "prime"];
    const isMultiSelect = multiTargetRoles.includes(role);
    const maxSelections = isMultiSelect ? 2 : 1;

    if (isMultiSelect) {
        instruction.style.display = "block";
        instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu khác nhau. Lượt chọn: 0/${maxSelections}`;
    }

    // Chỉ lọc những đối tượng còn sống làm mục tiêu hợp lệ
    const validTargets = playersList.filter(p => p.alive && p.id !== Net.playerId);

    if (validTargets.length === 0) {
        alert("Không tìm thấy mục tiêu hợp lệ nào còn sống để thi triển!");
        return;
    }

    // Render danh sách mục tiêu
    validTargets.forEach(p => {
        const targetBtn = document.createElement("div");
        targetBtn.className = "target-btn-box";
        targetBtn.innerHTML = `<span class="name">${p.name}</span>`;
        
        targetBtn.addEventListener("click", () => {
            if (isMultiSelect) {
                if (selectedPlayerIds.includes(p.id)) {
                    // Nếu bấm lại mục tiêu đã chọn, hủy kích hoạt
                    selectedPlayerIds = selectedPlayerIds.filter(id => id !== p.id);
                    targetBtn.classList.remove("selected");
                } else {
                    if (selectedPlayerIds.length < maxSelections) {
                        selectedPlayerIds.push(p.id);
                        targetBtn.classList.add("selected");
                    } else {
                        // Vượt quá giới hạn, đẩy mục tiêu đầu tiên ra
                        const removedId = selectedPlayerIds.shift();
                        document.querySelectorAll(".target-btn-box").forEach(btn => {
                            // Cập nhật lại UI bỏ highlight
                            const nameEl = btn.querySelector(".name");
                            const matchingPlayer = validTargets.find(pl => pl.id === removedId);
                            if (matchingPlayer && nameEl && nameEl.innerText === matchingPlayer.name) {
                                btn.classList.remove("selected");
                            }
                        });
                        selectedPlayerIds.push(p.id);
                        targetBtn.classList.add("selected");
                    }
                }
                instruction.innerText = `Kỹ năng yêu cầu chọn đủ ${maxSelections} mục tiêu khác nhau. Lượt chọn: ${selectedPlayerIds.length}/${maxSelections}`;
            } else {
                // Thao tác chọn 1 mục tiêu duy nhất
                document.querySelectorAll(".target-btn-box").forEach(btn => btn.classList.remove("selected"));
                targetBtn.classList.add("selected");
                selectedPlayerIds = [p.id];
            }
        });
        
        grid.appendChild(targetBtn);
    });

    // 2.2 Cấu hình Bổ Trợ Hành Động (Modifiers) cho các vai trò đặc thù
    if (role === "seer") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "seer_scan", label: "🔮 Thấu Thị" },
            { id: "seer_open_eye", label: "👁️ Khai Nhãn" }
        ]);
    } else if (role === "witch") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "heal", label: "🧪 Bình Cứu" },
            { id: "poison", label: "☠️ Bình Độc" }
        ]);
    } else if (role === "avenger") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "anesthetize", label: "💤 Gây Mê" },
            { id: "execute", label: "⚔️ Phán Quyết" }
        ]);
    } else if (role === "arsonist") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "pour_petrol", label: "🛢️ Tẩm Xăng" },
            { id: "ignite", label: "🔥 Châm Lửa" }
        ]);
    } else if (role === "cat") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "tear", label: "🐾 Xé Xác" },
            { id: "seal", label: "🔒 Phong Ấn" }
        ]);
    } else if (role === "reaper") {
        modifiersBox.classList.remove("hidden");
        renderModifiersHTML([
            { id: "harvest", label: "🪦 Gặt Xác" },
            { id: "influence", label: "💀 Chỉ Đạo Vote" }
        ]);
    }

    // Hàm render nút modifier động
    function renderModifiersHTML(options) {
        options.forEach((opt, idx) => {
            const btn = document.createElement("button");
            btn.className = "btn-suggest btn-small";
            btn.innerText = opt.label;
            if (idx === 0) {
                btn.className = "btn-accent btn-small";
                chosenModifier = opt.id;
            }
            btn.addEventListener("click", () => {
                document.querySelectorAll("#target-action-modifiers button").forEach(b => b.className = "btn-suggest btn-small");
                btn.className = "btn-accent btn-small";
                chosenModifier = opt.id;
            });
            modifiersBox.appendChild(btn);
        });
    }

    // 2.3 Cấu hình bổ trợ nhập liệu chữ dành riêng cho Vẹt (Parrot)
    if (role === "parrot") {
        textInputBox.classList.remove("hidden");
        const phraseInput = document.getElementById("target-phrase-input");
        if (phraseInput) phraseInput.value = ""; 
    }

    // Ràng buộc sự kiện nút bấm xác nhận
    const submitBtn = document.getElementById("target-modal-submit");
    const cancelBtn = document.getElementById("target-modal-close");

    submitBtn.onclick = () => {
        if (selectedPlayerIds.length === 0) {
            alert("Vui lòng chạm chọn mục tiêu trước!");
            return;
        }
        if (isMultiSelect && selectedPlayerIds.length < maxSelections) {
            alert(`Vai trò này yêu cầu bạn phải chọn đúng đủ ${maxSelections} mục tiêu!`);
            return;
        }

        // Lấy câu thoại của Parrot nếu có
        if (role === "parrot") {
            const phraseInput = document.getElementById("target-phrase-input");
            extraPhrase = phraseInput ? phraseInput.value.trim() : "";
            if (!extraPhrase) {
                alert("Vui lòng nhập câu thoại bắt đối phương nói nhại!");
                return;
            }
        }

        // Thực thi gọi hàm callback và giải phóng modal
        const finalTargetId = selectedPlayerIds[0];
        const finalSecondaryId = isMultiSelect ? selectedPlayerIds[1] : null;

        onConfirmCallback(finalTargetId, finalSecondaryId, chosenModifier, extraPhrase);
        ModalManager.closeCurrent();
    };

    cancelBtn.onclick = () => {
        ModalManager.closeCurrent();
    };

    // Gọi hiển thị bảng qua ModalManager
    ModalManager.open("target-modal");
}

// ==========================================
// 3. ĐỒNG BỘ TABS ĐIỀU HƯỚNG TRÊN DI ĐỘNG (MOBILE LAYOUT SYNC)
// ==========================================
export function initMobileTabSync() {
    const tabSelectors = ["nav-tab1", "nav-tab2", "nav-tab3", "nav-tab4", "nav-tab5"];
    
    tabSelectors.forEach((tabId, index) => {
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            tabElement.addEventListener("click", () => {
                // Đặt cấu hình Tab đang chọn lên thẻ Body để CSS xử lý ẩn/hiện cột tương ứng
                document.body.setAttribute("data-mobile-tab", index + 1);
                
                // Đồng bộ hóa trạng thái nút Active
                tabSelectors.forEach(id => {
                    document.getElementById(id)?.classList.remove("active");
                });
                tabElement.classList.add("active");
            });
        }
    });
}

// ==========================================
// 4. BỆNH ÁN CHI TIẾT NGƯỜI CHƠI (PLAYER BOTTOM SHEET)
// ==========================================
export function showPlayerBottomSheet(playerData, isGM = false) {
    const overlay = document.getElementById("player-sheet-overlay");
    const sheet = document.getElementById("player-sheet-modal");
    if (!overlay || !sheet) return;

    // Tiêm cấu trúc dữ liệu người chơi trực tiếp vào bottom sheet
    sheet.innerHTML = `
        <div class="sheet-header">
            <div class="sheet-avatar">👤</div>
            <div class="sheet-info">
                <h3>${playerData.name}</h3>
                <p>Mã Định Danh: ${playerData.id}</p>
            </div>
        </div>
        
        <div class="switch-row">
            <span class="switch-label">Tình Trạng Sinh Mệnh:</span>
            <span style="font-weight: bold; color: ${playerData.alive ? "var(--success)" : "var(--danger)"}">
                ${playerData.alive ? "🟢 CÒN SỐNG" : "🪦 ĐÃ LOẠI SỐ PHẬN"}
            </span>
        </div>

        ${isGM ? `
            <div class="switch-row" style="background: rgba(225, 29, 72, 0.05); padding: 10px; border-radius: 8px;">
                <span class="switch-label" style="color: var(--danger)">Hành Động Quản Trò (Host Only):</span>
                <button class="btn-danger btn-small" onclick="UI_Module.executeDeath('${playerData.id}')">XỬ TỬ NGƯỜI CHƠI</button>
            </div>
        ` : ""}
        
        <button id="btn-close-sheet" class="btn-suggest w-100" style="margin-top: 20px;">ĐÓNG LÝ LỊCH</button>
    `;

    overlay.style.display = "flex";
    setTimeout(() => {
        sheet.classList.add("show");
    }, 10);

    const closeSheet = () => {
        sheet.classList.remove("show");
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    };

    document.getElementById("btn-close-sheet")?.addEventListener("click", closeSheet);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeSheet();
    });
}

// ==========================================
// 5. QUẢN LÝ TIỆN ÍCH ÂM THANH & CÀI ĐẶT
// ==========================================
export function setupSoundSettings() {
    const bgmPlayer = document.getElementById("bgm-player");
    const sfxPlayer = document.getElementById("sfx-player");
    const bgmVol = document.getElementById("bgm-volume");
    const sfxVol = document.getElementById("sfx-volume");
    const btnMuteBgm = document.getElementById("btn-mute-bgm");
    const btnMuteSfx = document.getElementById("btn-mute-sfx");

    // Lắng nghe chỉnh lượng âm thanh BGM
    bgmVol?.addEventListener("input", (e) => {
        if (bgmPlayer) bgmPlayer.volume = e.target.value;
    });

    // Lắng nghe chỉnh lượng âm thanh SFX
    sfxVol?.addEventListener("input", (e) => {
        if (sfxPlayer) sfxPlayer.volume = e.target.value;
    });

    // Nút tắt BGM nhanh
    btnMuteBgm?.addEventListener("click", () => {
        if (bgmPlayer) {
            bgmPlayer.muted = !bgmPlayer.muted;
            btnMuteBgm.innerText = bgmPlayer.muted ? "Bật BGM" : "Tắt BGM";
            btnMuteBgm.className = bgmPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    // Nút tắt SFX nhanh
    btnMuteSfx?.addEventListener("click", () => {
        if (sfxPlayer) {
            sfxPlayer.muted = !sfxPlayer.muted;
            btnMuteSfx.innerText = sfxPlayer.muted ? "Bật SFX" : "Tắt SFX";
            btnMuteSfx.className = sfxPlayer.muted ? "btn-success btn-small" : "btn-danger btn-small";
        }
    });

    // Xử lý mở panel cài đặt khi bấm nút bánh răng desktop
    document.getElementById("btn-desktop-settings")?.addEventListener("click", () => {
        document.getElementById("panel-settings-donate").style.display = "flex";
        document.getElementById("desktop-overlay").style.display = "block";
    });

    const closeSettings = () => {
        document.getElementById("panel-settings-donate").style.display = "none";
        document.getElementById("desktop-overlay").style.display = "none";
    };

    document.getElementById("btn-close-settings")?.addEventListener("click", closeSettings);
    document.getElementById("desktop-overlay")?.addEventListener("click", closeSettings);
}