import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet, Plus, ArrowDownLeft, ArrowUpRight, Gift, Upload, ChevronRight,
  Loader, CheckCircle, XCircle, Info, HelpCircle, X, ShoppingBag,
  Lock, Eye, EyeOff, LogOut, ShieldCheck, Package, ExternalLink, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

// ── Session helpers ───────────────────────────────────────────────────────────
const SESSION_KEY = "wallet_token";
function getStoredToken(): string { return sessionStorage.getItem(SESSION_KEY) || ""; }
function setStoredToken(t: string) { sessionStorage.setItem(SESSION_KEY, t); }
function clearStoredToken() { sessionStorage.removeItem(SESSION_KEY); }

// ── Image compress ────────────────────────────────────────────────────────────
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        const maxPx = 1600;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round((height * maxPx) / width); width = maxPx; }
          else { width = Math.round((width * maxPx) / height); height = maxPx; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Transaction {
  id: number; type: string; amount: number; description: string; created_at: string;
}
interface WalletData {
  username: string; balance: number; transactions: Transaction[];
}
interface MyOrder {
  id: number;
  product_name: string;
  status: "pending" | "approved" | "rejected";
  payment_type: string;
  invite_links: string[];
  created_at: string | null;
}

// ── PIN input component ───────────────────────────────────────────────────────
function PinInput({ value, onChange, placeholder = "● ● ● ● ● ●", disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        className="w-full bg-muted border border-border rounded-lg pl-9 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary tracking-widest"
        type={show ? "text" : "password"}
        inputMode="numeric"
        maxLength={6}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <button type="button" onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// ── Username help popup ───────────────────────────────────────────────────────
function UsernameHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">วิธีหา Telegram Username</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          {[
            ["1", "เปิด Telegram แล้วไปที่", "Settings (ตั้งค่า)"],
            ["2", "ดูที่ช่อง", "Username — จะมีสัญลักษณ์ @ นำหน้า เช่น @myname"],
            ["3", "ถ้ายังไม่มี Username ให้กด", "Edit Profile แล้วตั้ง Username ก่อน"],
          ].map(([n, pre, em]) => (
            <div key={n} className="flex gap-3">
              <span className="bg-primary/20 text-primary rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
              <p>{pre} <span className="text-foreground font-medium">{em}</span></p>
            </div>
          ))}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-2">
            <p className="text-xs text-primary">Username ใช้เป็น ID บัญชีของคุณในระบบ กรุณาจำหรือจดไว้</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function TxnIcon({ type }: { type: string }) {
  if (type === "topup") return <ArrowDownLeft size={14} className="text-green-400" />;
  if (type === "purchase") return <ShoppingBag size={14} className="text-red-400" />;
  return <ArrowUpRight size={14} className="text-muted-foreground" />;
}
function TxnBadge({ type }: { type: string }) {
  if (type === "topup") return <Badge className="text-[10px] px-1.5 py-0 bg-green-500/15 text-green-400 border-green-500/30">เติมเงิน</Badge>;
  if (type === "purchase") return <Badge className="text-[10px] px-1.5 py-0 bg-red-500/15 text-red-400 border-red-500/30">ซื้อสินค้า</Badge>;
  return <Badge className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">ปรับยอด</Badge>;
}

// ── Order status badge ────────────────────────────────────────────────────────
function OrderStatusBadge({ status }: { status: string }) {
  if (status === "approved") return (
    <Badge className="text-[10px] px-1.5 py-0 bg-green-500/15 text-green-400 border-green-500/30 flex items-center gap-1">
      <CheckCircle size={9} /> อนุมัติแล้ว
    </Badge>
  );
  if (status === "rejected") return (
    <Badge className="text-[10px] px-1.5 py-0 bg-red-500/15 text-red-400 border-red-500/30 flex items-center gap-1">
      <XCircle size={9} /> ไม่อนุมัติ
    </Badge>
  );
  return (
    <Badge className="text-[10px] px-1.5 py-0 bg-yellow-500/15 text-yellow-400 border-yellow-500/30 flex items-center gap-1">
      <Clock size={9} /> รอตรวจสอบ
    </Badge>
  );
}

// ── Login / register screen ───────────────────────────────────────────────────
type LoginStep = "username" | "check" | "pin" | "create_pin" | "confirm_pin";

function LoginScreen({ onLoggedIn }: { onLoggedIn: (token: string, username: string) => void }) {
  const [step, setStep] = useState<LoginStep>("username");
  const [username, setUsername] = useState("");
  const [inputUsername, setInputUsername] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const checkUser = async () => {
    const u = inputUsername.replace(/^@/, "").trim().toLowerCase();
    if (!u) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/wallet/check/${encodeURIComponent(u)}`);
      const data = await res.json();
      setUsername(u);
      setHasPin(data.has_pin);
      setStep(data.has_pin ? "pin" : "create_pin");
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  };

  const doAuth = async () => {
    if (step === "create_pin" && pin.length < 4) { setError("PIN ต้องมีอย่างน้อย 4 หลัก"); return; }
    if (step === "create_pin") { setStep("confirm_pin"); setConfirmPin(""); setError(""); return; }
    if (step === "confirm_pin" && pin !== confirmPin) { setError("PIN ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง"); setConfirmPin(""); return; }
    if (step === "pin" && pin.length < 4) { setError("กรุณาใส่ PIN"); return; }

    setLoading(true); setError("");
    try {
      const res = await fetch("/api/wallet/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, pin, confirm_pin: confirmPin || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เกิดข้อผิดพลาด");
      setStoredToken(data.token);
      onLoggedIn(data.token, username);
    } catch (e: any) {
      setError(e.message);
      if (step === "pin") setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <AnimatePresence>{showHelp && <UsernameHelp onClose={() => setShowHelp(false)} />}</AnimatePresence>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            {step === "username" ? <Wallet size={28} className="text-primary" /> : <ShieldCheck size={28} className="text-primary" />}
          </div>
          <h1 className="text-2xl font-bold text-foreground">กระเป๋าเครดิต</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === "username" && "ใส่ Telegram Username เพื่อเข้าถึงกระเป๋าของคุณ"}
            {step === "pin" && `ยืนยันตัวตน @${username}`}
            {step === "create_pin" && `สร้าง PIN สำหรับ @${username}`}
            {step === "confirm_pin" && "ยืนยัน PIN อีกครั้ง"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          {step === "username" && (
            <>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Telegram Username</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                  <input
                    className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="username ของคุณ"
                    value={inputUsername.replace(/^@/, "")}
                    onChange={e => setInputUsername(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && checkUser()}
                    disabled={loading}
                  />
                </div>
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button className="w-full" onClick={checkUser} disabled={!inputUsername.trim() || loading}>
                {loading ? <Loader size={14} className="animate-spin" /> : <>ต่อไป <ChevronRight size={16} /></>}
              </Button>
              <button onClick={() => setShowHelp(true)} className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors">
                <HelpCircle size={13} /> ไม่รู้จะหา Username ได้จากไหน?
              </button>
            </>
          )}

          {step === "pin" && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-foreground">PIN ของคุณ</label>
                  <span className="text-xs text-muted-foreground">@{username}</span>
                </div>
                <PinInput value={pin} onChange={setPin} disabled={loading} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button className="w-full" onClick={doAuth} disabled={pin.length < 4 || loading}>
                {loading ? <Loader size={14} className="animate-spin" /> : "เข้าสู่กระเป๋า"}
              </Button>
              <button onClick={() => { setStep("username"); setPin(""); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                ← เปลี่ยน Username
              </button>
            </>
          )}

          {step === "create_pin" && (
            <>
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-primary">
                <p className="font-medium mb-0.5">บัญชีใหม่ — สร้าง PIN ของคุณ</p>
                <p className="opacity-80">PIN ใช้ยืนยันตัวตนทุกครั้งที่เข้าใช้กระเป๋า ตัวเลข 4–6 หลัก</p>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">ตั้ง PIN (4–6 หลัก)</label>
                <PinInput value={pin} onChange={setPin} placeholder="● ● ● ●" disabled={loading} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button className="w-full" onClick={doAuth} disabled={pin.length < 4 || loading}>
                {loading ? <Loader size={14} className="animate-spin" /> : <>ถัดไป — ยืนยัน PIN <ChevronRight size={16} /></>}
              </Button>
              <button onClick={() => { setStep("username"); setPin(""); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                ← เปลี่ยน Username
              </button>
            </>
          )}

          {step === "confirm_pin" && (
            <>
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">ยืนยัน PIN อีกครั้ง</label>
                <PinInput value={confirmPin} onChange={setConfirmPin} placeholder="● ● ● ●" disabled={loading} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <Button className="w-full" onClick={doAuth} disabled={confirmPin.length < 4 || loading}>
                {loading ? <Loader size={14} className="animate-spin" /> : "สร้างบัญชีและเข้าสู่ระบบ"}
              </Button>
              <button onClick={() => { setStep("create_pin"); setConfirmPin(""); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                ← แก้ไข PIN
              </button>
            </>
          )}
        </div>

        <button onClick={() => window.history.back()} className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
          กลับหน้าหลัก
        </button>
      </motion.div>
    </div>
  );
}

// ── My Orders tab ─────────────────────────────────────────────────────────────
function MyOrdersTab({ token }: { token: string }) {
  const authHeaders = { Authorization: `Bearer ${token}` };

  const { data: orders = [], isLoading } = useQuery<MyOrder[]>({
    queryKey: ["wallet-my-orders", token],
    queryFn: async () => {
      const res = await fetch("/api/wallet/my-orders", { headers: authHeaders });
      if (!res.ok) throw new Error("โหลดไม่ได้");
      return res.json();
    },
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted/30 animate-pulse rounded-xl" />)}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <Package size={32} className="text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">ยังไม่มีสินค้า</p>
        <p className="text-xs text-muted-foreground mt-1">ซื้อสินค้าแล้วจะแสดงลิงก์เข้ากลุ่มที่นี่</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map(order => (
        <motion.div key={order.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{order.product_name}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                ออเดอร์ #{order.id} •{" "}
                {order.created_at
                  ? new Date(order.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : ""}
              </p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>

          {order.status === "approved" && order.invite_links.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">🔗 ลิงก์เข้ากลุ่ม (ใช้ได้ครั้งเดียว)</p>
              {order.invite_links.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2.5 text-sm text-primary hover:bg-primary/20 transition-colors">
                  <ExternalLink size={13} className="shrink-0" />
                  <span className="truncate">{link}</span>
                </a>
              ))}
            </div>
          )}

          {order.status === "approved" && order.invite_links.length === 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-400">
              อนุมัติแล้ว — แอดมินกำลังส่งลิงก์ กรุณารอสักครู่
            </div>
          )}

          {order.status === "pending" && (
            <div className="bg-muted/50 border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
              รอแอดมินตรวจสอบการชำระเงิน
            </div>
          )}

          {order.status === "rejected" && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
              การชำระเงินไม่ผ่าน — ติดต่อแอดมินเพื่อตรวจสอบ
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

interface StoreSettings {
  topup_slip_enabled: string;
  topup_truemoney_enabled: string;
}

// ── Main WalletPage ───────────────────────────────────────────────────────────
export default function WalletPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const [token, setToken] = useState(getStoredToken);
  const [username, setUsername] = useState("");
  const [activeTab, setActiveTab] = useState<"wallet" | "orders">("wallet");
  const [topupModal, setTopupModal] = useState(false);
  const [topupType, setTopupType] = useState<"slip" | "truemoney">("truemoney");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [amountHint, setAmountHint] = useState("");
  const [voucherLink, setVoucherLink] = useState("");
  const [topupResult, setTopupResult] = useState<{ ok: boolean; message: string; amount?: number } | null>(null);
  const [topupError, setTopupError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: storeSettings } = useQuery<StoreSettings>({
    queryKey: ["store-settings-topup"],
    queryFn: () => fetch("/api/store-settings").then(r => r.json()),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const slipEnabled = (storeSettings?.topup_slip_enabled ?? "on") === "on";
  const trueMoneyEnabled = (storeSettings?.topup_truemoney_enabled ?? "on") === "on";

  const walletQuery = useQuery<WalletData>({
    queryKey: ["wallet-me", token],
    queryFn: async () => {
      const res = await fetch("/api/wallet/me", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { clearStoredToken(); setToken(""); throw new Error("session หมดอายุ"); }
      return res.json();
    },
    enabled: !!token,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (walletQuery.data?.username) setUsername(walletQuery.data.username);
  }, [walletQuery.data]);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const slipMutation = useMutation({
    mutationFn: async () => {
      if (!slipFile) throw new Error("กรุณาแนบสลีป");
      const proof = await compressImage(slipFile);
      const res = await fetch("/api/wallet/topup/slip", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ payment_proof: proof, amount_hint: amountHint ? parseFloat(amountHint) : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เกิดข้อผิดพลาด");
      return data;
    },
    onSuccess: (data) => {
      setTopupResult({ ok: true, message: data.auto_approved ? "เติมเงินสำเร็จ! เพิ่มเครดิตเรียบร้อย" : "ส่งคำขอแล้ว รอแอดมินอนุมัติ", amount: data.auto_approved ? data.balance : undefined });
      qc.invalidateQueries({ queryKey: ["wallet-me"] });
    },
    onError: (e: Error) => setTopupError(e.message),
  });

  const tmMutation = useMutation({
    mutationFn: async () => {
      if (!voucherLink.trim()) throw new Error("กรุณาใส่ลิงก์ซอง");
      const res = await fetch("/api/wallet/topup/truemoney", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ voucher: voucherLink.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เกิดข้อผิดพลาด");
      return data;
    },
    onSuccess: (data) => {
      setTopupResult({ ok: true, message: data.auto_approved ? `แลกซองสำเร็จ! ได้รับ ${data.amount} เครดิต` : (data.message || "ส่งคำขอแล้ว รอแอดมินอนุมัติ"), amount: data.amount });
      qc.invalidateQueries({ queryKey: ["wallet-me"] });
    },
    onError: (e: Error) => setTopupError(e.message),
  });

  const handleLogout = () => { clearStoredToken(); setToken(""); setUsername(""); qc.clear(); };
  const handleTopupClose = () => {
    setTopupModal(false); setSlipFile(null); setSlipPreview(null);
    setAmountHint(""); setVoucherLink(""); setTopupResult(null); setTopupError("");
  };
  const handleTopupOpen = () => {
    if (!slipEnabled && trueMoneyEnabled) setTopupType("truemoney");
    if (slipEnabled && !trueMoneyEnabled) setTopupType("slip");
    setTopupModal(true);
  };
  const handleTopupSubmit = () => { setTopupError(""); if (topupType === "slip") slipMutation.mutate(); else tmMutation.mutate(); };
  const isPending = slipMutation.isPending || tmMutation.isPending;
  const noTopupAvailable = !slipEnabled && !trueMoneyEnabled;

  if (!token) {
    return <LoginScreen onLoggedIn={(tok, uname) => { setToken(tok); setUsername(uname); }} />;
  }

  const balance = walletQuery.data?.balance ?? 0;
  const transactions = walletQuery.data?.transactions ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-30">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => setLocation("/")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
            <ChevronRight size={14} className="rotate-180" /> หน้าร้าน
          </button>
          <span className="text-sm font-semibold text-foreground">@{username || "..."}</span>
          <button onClick={handleLogout} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            <LogOut size={13} /> ออก
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Balance card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border border-primary/30 rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">บัญชี</p>
              <p className="text-sm font-semibold text-foreground">@{username || "..."}</p>
            </div>
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
              <Wallet size={18} className="text-primary" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-1">ยอดเครดิตคงเหลือ</p>
          {walletQuery.isLoading ? (
            <div className="h-9 w-32 bg-muted/50 animate-pulse rounded" />
          ) : (
            <p className="text-3xl font-bold text-foreground">
              {balance.toLocaleString("th-TH")}
              <span className="text-base font-normal text-muted-foreground ml-1">เครดิต</span>
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" className="flex-1 gap-1.5" onClick={handleTopupOpen} disabled={noTopupAvailable}>
              <Plus size={14} /> {noTopupAvailable ? "ปิดรับเติมเงินชั่วคราว" : "เติมเครดิต"}
            </Button>
            <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => setLocation("/")}>
              <ShoppingBag size={14} /> ซื้อสินค้า
            </Button>
          </div>
        </motion.div>

        {walletQuery.isError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400 flex items-center justify-between">
            <span>กรุณาเข้าสู่ระบบใหม่</span>
            <Button size="sm" variant="outline" onClick={handleLogout} className="text-xs">เข้าสู่ระบบ</Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex bg-muted rounded-xl p-1 gap-1">
          {([
            { key: "orders", label: "สินค้าของฉัน", icon: Package },
            { key: "wallet", label: "ประวัติธุรกรรม", icon: Wallet },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${activeTab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {activeTab === "orders" ? (
            <motion.div key="orders" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
              <MyOrdersTab token={token} />
            </motion.div>
          ) : (
            <motion.div key="wallet" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}>
              {walletQuery.isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted/30 animate-pulse rounded-xl" />)}</div>
              ) : transactions.length === 0 ? (
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <Wallet size={28} className="text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">ยังไม่มีธุรกรรม</p>
                  <p className="text-xs text-muted-foreground mt-1">เติมเครดิตเพื่อเริ่มซื้อสินค้า</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map(t => (
                    <motion.div key={t.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${t.type === "topup" ? "bg-green-500/15" : t.type === "purchase" ? "bg-red-500/15" : "bg-muted"}`}>
                        <TxnIcon type={t.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{t.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <TxnBadge type={t.type} />
                          <span className="text-[11px] text-muted-foreground">
                            {t.created_at ? new Date(t.created_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                          </span>
                        </div>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${t.amount >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {t.amount >= 0 ? "+" : ""}{t.amount.toLocaleString("th-TH")}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Top-up dialog */}
      <Dialog open={topupModal} onOpenChange={handleTopupClose}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader><DialogTitle className="text-base">เติมเครดิต</DialogTitle></DialogHeader>

          {topupResult ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-4 text-center">
              {topupResult.ok ? <CheckCircle size={48} className="text-green-400" /> : <XCircle size={48} className="text-red-400" />}
              <div>
                <p className="font-semibold text-foreground">{topupResult.message}</p>
                {topupResult.amount != null && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ยอดเครดิตปัจจุบัน: <span className="text-foreground font-medium">{walletQuery.data?.balance?.toLocaleString("th-TH")} เครดิต</span>
                  </p>
                )}
              </div>
              <Button onClick={handleTopupClose} className="w-full">ปิด</Button>
            </motion.div>
          ) : (
            <div className="space-y-4 pt-1">
              {/* Only show selector if both methods are enabled */}
              {slipEnabled && trueMoneyEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  {(["truemoney", "slip"] as const).map(t => (
                    <button key={t} onClick={() => setTopupType(t)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-colors ${topupType === t ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground hover:border-primary/50"}`}>
                      {t === "truemoney" ? <Gift size={20} /> : <Upload size={20} />}
                      {t === "truemoney" ? "ซองอั่งเปา" : "โอนสลีป"}
                      <span className="text-[10px] opacity-70">{t === "truemoney" ? "TrueMoney" : "ธนาคาร"}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Single method header label */}
              {!(slipEnabled && trueMoneyEnabled) && (
                <div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2.5">
                  {topupType === "truemoney" ? <Gift size={16} className="text-primary" /> : <Upload size={16} className="text-primary" />}
                  <span className="text-sm font-medium text-foreground">{topupType === "truemoney" ? "ซองอั่งเปา TrueMoney" : "โอนสลีปธนาคาร"}</span>
                </div>
              )}

              {topupType === "truemoney" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">ลิงก์ซองอั่งเปา</label>
                    <input className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="https://gift.truemoney.com/campaign/?v=..." value={voucherLink} onChange={e => setVoucherLink(e.target.value)} />
                  </div>
                  <div className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5 text-xs text-blue-300">
                    <Info size={13} className="shrink-0 mt-0.5" />
                    <p>ระบบจะแลกซองอัตโนมัติ เครดิตเพิ่มทันที 1 บาท = 1 เครดิต</p>
                  </div>
                </div>
              )}

              {topupType === "slip" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">จำนวนเงินที่โอน (บาท)</label>
                    <input className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="เช่น 100" value={amountHint} onChange={e => setAmountHint(e.target.value)} type="number" min="1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">แนบสลีปโอนเงิน</label>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) { setSlipFile(f); setSlipPreview(URL.createObjectURL(f)); }
                    }} />
                    {slipPreview ? (
                      <div className="relative rounded-lg overflow-hidden border border-border">
                        <img src={slipPreview} alt="slip" className="w-full max-h-48 object-contain bg-muted" />
                        <button onClick={() => { setSlipFile(null); setSlipPreview(null); }}
                          className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => fileRef.current?.click()}
                        className="w-full border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors">
                        <Upload size={20} />
                        <span className="text-xs">กดเพื่อเลือกรูปสลีป</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {topupError && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">
                  <XCircle size={14} className="shrink-0" />{topupError}
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleTopupClose} className="flex-1">ยกเลิก</Button>
                <Button onClick={handleTopupSubmit} disabled={isPending || (topupType === "slip" ? !slipFile : !voucherLink)} className="flex-1">
                  {isPending ? <Loader size={14} className="animate-spin" /> : "ยืนยันเติมเงิน"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Export session helper for use in StoreFront ────────────────────────────────
export { getStoredToken, clearStoredToken };
