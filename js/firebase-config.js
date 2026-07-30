/**
 * =========================================================================
 * WOLFPACK SOVEREIGN v47.0 - FIREBASE CORE CONFIGURATION MODULE (UPDATE 8 FULL)
 * =========================================================================
 * Tệp cấu hình khởi tạo kết nối Firebase App, Realtime Database, Analytics,
 * Bù trừ chênh lệch thời gian Server (Time Offset Sync), Xác thực Mật khẩu phòng,
 * Dọn dẹp Node dữ liệu rác và cung cấp toàn bộ Helper References cho hệ thống v47.0.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { 
    getDatabase, 
    ref, 
    set, 
    get, 
    onValue, 
    update, 
    push, 
    remove, 
    child, 
    onDisconnect,
    runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// THÔNG SỐ CẤU HÌNH CLOUD FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyANIopuQprhN_dHI2W7WYwwPU2U4_Q8cWQ",
    authDomain: "wolfsovereignonline.firebaseapp.com",
    databaseURL: "https://wolfsovereignonline-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "wolfsovereignonline",
    storageBucket: "wolfsovereignonline.firebasestorage.app",
    messagingSenderId: "325072915230",
    appId: "1:325072915230:web:890a43e396cd847046170f",
    measurementId: "G-0T9D3HPPQL"
};

// 1. Khởi tạo Thực thể Firebase App
const app = initializeApp(firebaseConfig);

// 2. Khởi tạo Thực thể Realtime Database
const db = getDatabase(app);

// 3. Khởi tạo Dịch vụ Analytics An Toàn (Chống nghẽn khi chạy Localhost hoặc bị chặn adblock)
let analytics = null;
isSupported().then((supported) => {
    if (supported) {
        try {
            analytics = getAnalytics(app);
            console.log("🌐 [Firebase Analytics] Khởi tạo thành công.");
        } catch (err) {
            console.warn("⚠️ [Firebase Analytics] Bị trình duyệt chặn:", err.message);
        }
    } else {
        console.warn("⚠️ [Firebase Analytics] Môi trường hiện tại không hỗ trợ Analytics.");
    }
}).catch((err) => {
    console.warn("⚠️ [Firebase Analytics] Kiểm tra hỗ trợ thất bại:", err.message);
});

// 4. BỘ GIÁM SÁT VÀ ĐỒNG BỘ THỜI GIAN MÁY CHỦ (SERVER TIME OFFSET SYNCHRONIZATION)
let serverTimeOffset = 0;
const offsetRef = ref(db, ".info/serverTimeOffset");
onValue(offsetRef, (snap) => {
    serverTimeOffset = snap.val() || 0;
    console.log(`⏱️ [Firebase Time Sync] Server Offset: ${serverTimeOffset}ms`);
});

/**
 * Lấy thời gian đồng bộ chuẩn theo giờ Server Firebase (Chống desync đồng hồ client)
 * @returns {number} Timestamp milliseconds chuẩn xác
 */
export const getSynchronizedTimestamp = () => {
    return Date.now() + serverTimeOffset;
};

/**
 * Lấy giá trị lệch thời gian hiện tại giữa máy Client và Server
 * @returns {number} Offset ms
 */
export const getServerTimeOffset = () => serverTimeOffset;

// 5. TIỆN ÍCH TẠO REFERENCE ĐƯỜNG DẪN CHUẨN TRONG GAME (HỆ THỐNG MỞ RỘNG v47.0)

/** Trả về reference gốc của một phòng chơi */
export const getRoomRef = (roomId) => ref(db, `rooms/${roomId}`);

/** Trả về reference dữ liệu Metadata của phòng */
export const getMetaRef = (roomId) => ref(db, `rooms/${roomId}/meta`);

/** Trả về reference danh sách toàn bộ người chơi trong phòng */
export const getPlayersRef = (roomId) => ref(db, `rooms/${roomId}/players`);

/** Trả về reference thông tin của một người chơi cụ thể */
export const getPlayerRef = (roomId, playerId) => ref(db, `rooms/${roomId}/players/${playerId}`);

/** Trả về reference kênh chat cụ thể (Public, Wolf, Couple, Prime, Graveyard...) */
export const getChatsRef = (roomId, channelPath) => ref(db, `rooms/${roomId}/chats/${channelPath}`);

/** Trả về reference Hòm Mật Thư của một người chơi */
export const getMailboxRef = (roomId, playerId) => ref(db, `rooms/${roomId}/players/${playerId}/mailbox`);

/** Trả về reference Nhật Ký Quản Trò (GM Logs) */
export const getLogsRef = (roomId) => ref(db, `rooms/${roomId}/logs`);

/** Trả về reference Trạng Thái Tòa Án & Biểu Quyết */
export const getTrialRef = (roomId) => ref(db, `rooms/${roomId}/trial`);

/** Trả về reference Phiếu bầu chọn mục tiêu cắn của Bầy Sói (Wolf Votes Target Consensus) */
export const getWolfVotesRef = (roomId) => ref(db, `rooms/${roomId}/wolf_votes`);

/** Trả về reference Danh sách Đề cử treo cổ ban ngày */
export const getNominationsRef = (roomId) => ref(db, `rooms/${roomId}/nominations`);

/** Trả về reference Phiếu bầu Trưởng Làng */
export const getMayorVotesRef = (roomId) => ref(db, `rooms/${roomId}/mayor_votes`);

/** Trả về reference Thống kê Bình chọn Tỉ lệ Thắng Khán Giả */
export const getPredictionsRef = (roomId) => ref(db, `rooms/${roomId}/prediction_poll`);

/** Trả về reference Kênh Chat Thì Thầm Bí Mật của Quản Trò với 1 Người chơi */
export const getGMWhispersRef = (roomId, playerId) => ref(db, `rooms/${roomId}/gm_whispers/${playerId}`);

// 6. TIỆN ÍCH XÁC THỰC MẬT KHẨU PHÒNG CHƠI (ROOM PASSWORD ENFORCEMENT)
/**
 * Kiểm tra mật khẩu phòng khi người chơi thực hiện thao tác Gia nhập
 * @param {string} roomId - Mã phòng 6 ký tự
 * @param {string} inputPassword - Mật khẩu do người chơi nhập vào
 * @returns {Promise<{valid: boolean, reason?: string}>} Kết quả xác thực
 */
export const verifyRoomPassword = async (roomId, inputPassword = "") => {
    try {
        const metaSnapshot = await get(ref(db, `rooms/${roomId}/meta`));
        if (!metaSnapshot.exists()) {
            return { valid: false, reason: "Phòng chơi không tồn tại!" };
        }
        
        const meta = metaSnapshot.val();
        const roomPassword = meta.password || "";

        // Nếu phòng công khai (không cài mật khẩu)
        if (!roomPassword || String(roomPassword).trim() === "") {
            return { valid: true };
        }

        // So sánh mật khẩu đã chuẩn hóa
        if (String(roomPassword).trim() === String(inputPassword).trim()) {
            return { valid: true };
        } else {
            return { valid: false, reason: "Mật khẩu phòng chơi không chính xác!" };
        }
    } catch (err) {
        console.error("⚠️ [Verify Password Error]:", err);
        return { valid: false, reason: "Lỗi kết nối máy chủ khi kiểm tra mật khẩu phòng!" };
    }
};

// 7. BỘ DỌN DẸP DỮ LIỆU TẠM GIỮA CÁC VÁN CHƠI (PREVENT MEMORY/DATA BLOAT)
/**
 * Xóa sạch toàn bộ node rác khi bắt đầu ván mới trong cùng một mã phòng
 * @param {string} roomId - Mã phòng chơi
 */
export const resetGameRoomNodes = async (roomId) => {
    if (!roomId) return;
    const updates = {};
    updates[`rooms/${roomId}/wolf_votes`] = null;
    updates[`rooms/${roomId}/prediction_poll`] = null;
    updates[`rooms/${roomId}/nominations`] = null;
    updates[`rooms/${roomId}/votes`] = null;
    updates[`rooms/${roomId}/mayor_votes`] = null;
    updates[`rooms/${roomId}/gm_whispers`] = null;
    updates[`rooms/${roomId}/trial`] = {
        stage: "none",
        accusedId: null,
        accusedText: "",
        decisionText: ""
    };
    try {
        await update(ref(db), updates);
        console.log(`🧹 [Firebase Reset] Đã dọn sạch các node rác của phòng ${roomId}`);
    } catch (err) {
        console.error("⚠️ [Firebase Reset Error]:", err);
    }
};

// 8. BỘ GIÁM SÁT TRẠNG THÁI KẾT NỐI MẠNG (ONLINE/OFFLINE PRESENCE)
/**
 * Lắng nghe trạng thái kết nối tới máy chủ Firebase Realtime Database
 * @param {function(boolean): void} callback - Trả về true nếu Online, false nếu mất mạng
 */
export const monitorServerConnection = (callback) => {
    const connectedRef = ref(db, ".info/connected");
    return onValue(connectedRef, (snap) => {
        const isOnline = snap.val() === true;
        if (typeof callback === "function") {
            callback(isOnline);
        }
    });
};

// 9. Xuất toàn bộ các hàm Primitive của Firebase Database để dùng trên toàn hệ thống
export {
    app,
    db,
    analytics,
    ref,
    set,
    get,
    onValue,
    update,
    push,
    remove,
    child,
    onDisconnect,
    runTransaction
};