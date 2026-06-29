// Khởi tạo và liên kết các thư viện SDK Firebase từ importmap cấu hình trong index.html
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
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
} from "firebase/database";

// Thông số cấu hình đồng bộ hóa trực tuyến của ứng dụng Wolfpack Sovereign
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

// Khởi tạo thực thể Firebase App
const app = initializeApp(firebaseConfig);

// Khởi tạo dịch vụ phân tích dữ liệu (Analytics) đề phòng bị chặn bởi trình duyệt hoặc chạy trên localhost
let analytics = null;
try {
    analytics = getAnalytics(app);
} catch (error) {
    console.warn("Dịch vụ Analytics bị chặn hoặc không thể khởi tạo:", error.message);
}

// Khởi tạo thực thể Realtime Database để đồng bộ hóa trò chơi trực tuyến
const db = getDatabase(app);

// Xuất các thực thể và hàm ra ngoài để hệ thống sử dụng đồng bộ
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