import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ShoppingBag, Upload, Link, Clock, ChevronRight, ChevronLeft, Zap, Megaphone, Search, CheckCircle, XCircle, Loader, Building2, CreditCard, Wallet, HelpCircle, X, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";

async function compressSlipImage(file: File, maxPx = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round((height * maxPx) / width); width = maxPx; }
          else { width = Math.round((width * maxPx) / height); height = maxPx; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas ctx null")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  fake_discount_price: string | null;
  image_url: string | null;
  image_urls: string | null;
  is_active: boolean;
  is_featured: boolean;
  badge_text: string | null;
  badge_color: string | null;
  sales_count: number;
  sort_order: number;
}

interface StoreSettings {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  store_name: string;
  bot_username: string;
  bank_name: string;
  bank_account: string;
  bank_qr_url: string;
}

function getProductImages(product: Product): string[] {
  if (product.image_urls) {
    try {
      const parsed = JSON.parse(product.image_urls);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  if (product.image_url) return [product.image_url];
  return [];
}

function ImageCarousel({ images, aspectClass = "aspect-video" }: { images: string[]; aspectClass?: string }) {
  const [current, setCurrent] = useState(0);
  if (images.length === 0) return null;
  return (
    <div className={`relative ${aspectClass} bg-muted overflow-hidden`}>
      <img
        src={images[current]}
        alt=""
        className="w-full h-full object-cover transition-opacity duration-300"
        key={current}
      />
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setCurrent((c) => (c - 1 + images.length) % images.length); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={14} className="text-white" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCurrent((c) => (c + 1) % images.length); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          >
            <ChevronRight size={14} className="text-white" />
          </button>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
                className={`rounded-full transition-all ${i === current ? "w-4 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface OrderStatus {
  id: number;
  product_name: string;
  payment_type: string;
  status: string;
  link_sent: boolean;
  invite_links: string | null;
  created_at: string;
}

function useCountdown(productId: number) {
  const storageKey = `fomo_timer_${productId}`;
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const end = parseInt(stored, 10);
      const remaining = end - Date.now();
      return remaining > 0 ? remaining : 0;
    }
    const end = Date.now() + 15 * 60 * 1000;
    localStorage.setItem(storageKey, end.toString());
    return 15 * 60 * 1000;
  });

  useEffect(() => {
    if (timeLeft <= 0) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          localStorage.removeItem(storageKey);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [storageKey]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  return { minutes, seconds, expired: timeLeft <= 0 };
}

function CountdownBadge({ productId }: { productId: number }) {
  const { minutes, seconds, expired } = useCountdown(productId);
  if (expired) return null;
  return (
    <div className="flex items-center gap-1 text-xs font-mono text-red-400 bg-red-950/40 border border-red-800/40 rounded px-2 py-0.5">
      <Clock size={10} className="shrink-0" />
      <span>
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")} left
      </span>
    </div>
  );
}

function ProductCard({ product, onBuy }: { product: Product; onBuy: (p: Product) => void }) {
  const hasDiscount = product.fake_discount_price != null;
  const price = parseFloat(product.price);
  const fakePrice = product.fake_discount_price ? parseFloat(product.fake_discount_price) : null;
  const images = getProductImages(product);
  const badgeColor = product.badge_color || "#f59e0b";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="group relative flex flex-col bg-card rounded-xl overflow-hidden transition-all"
      style={product.is_featured
        ? { border: `2px solid ${badgeColor}`, boxShadow: `0 0 18px ${badgeColor}28` }
        : { border: "1px solid hsl(var(--border))" }}
    >
      {product.is_featured && product.badge_text && (
        <div className="absolute top-0 right-0 w-[72px] h-[72px] overflow-hidden z-20 pointer-events-none">
          <div
            className="absolute top-[18px] right-[-20px] text-[10px] font-bold px-7 py-[3px] rotate-45 text-white shadow-sm tracking-wide"
            style={{ backgroundColor: badgeColor }}
          >
            {product.badge_text}
          </div>
        </div>
      )}

      <div className="relative aspect-video bg-muted overflow-hidden">
        {images.length > 0 ? (
          <ImageCarousel images={images} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Zap size={32} className="text-primary/30" />
          </div>
        )}
        {hasDiscount && (
          <div className="absolute top-2 left-2 z-10">
            <Badge className="bg-red-600 text-white text-xs border-0">SALE</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 p-4 gap-3">
        <div>
          <h3 className="font-semibold text-foreground leading-tight">{product.name}</h3>
          {product.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
          )}
        </div>

        <div className="flex items-end justify-between mt-auto">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-primary">
                ฿{price.toLocaleString()}
              </span>
              {fakePrice && (
                <span className="text-sm text-muted-foreground line-through">
                  ฿{fakePrice.toLocaleString()}
                </span>
              )}
            </div>
            {hasDiscount && <CountdownBadge productId={product.id} />}
            {product.sales_count > 0 && (
              <p className="text-xs text-muted-foreground">
                🛒 ซื้อไปแล้ว <span className="text-foreground font-medium">{product.sales_count.toLocaleString()}</span> ครั้ง
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => onBuy(product)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            ซื้อเลย
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function BuyModal({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();

  // Read token from sessionStorage (set by WalletPage after PIN login)
  const [token, setToken] = useState(() => sessionStorage.getItem("wallet_token") || "");
  const [result, setResult] = useState<{ order_id: number; invite_links: string[]; balance: number } | null>(null);
  const [error, setError] = useState("");

  // Mini login state (used when not yet logged in)
  const [miniStep, setMiniStep] = useState<"username" | "pin">("username");
  const [inputUsername, setInputUsername] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [miniError, setMiniError] = useState("");
  const [miniLoading, setMiniLoading] = useState(false);

  const walletQuery = useQuery<{ username: string; balance: number }>({
    queryKey: ["wallet-me-modal", token],
    queryFn: async () => {
      const res = await fetch("/api/wallet/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("unauthorized");
      return res.json();
    },
    enabled: !!token && !!product,
    retry: false,
  });

  // If token is invalid, clear it so mini-login shows
  const isTokenValid = !!token && !walletQuery.isError;

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("ไม่พบสินค้า");
      const res = await fetch("/api/wallet/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ product_id: product.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เกิดข้อผิดพลาด");
      return data;
    },
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => setError(e.message),
  });

  const handleClose = () => {
    setResult(null); setError(""); setMiniError(""); setPin("");
    onClose();
  };

  // Mini login: check username then authenticate
  const handleMiniCheckUser = async () => {
    const u = inputUsername.replace(/^@/, "").trim().toLowerCase();
    if (!u) return;
    setMiniLoading(true); setMiniError("");
    try {
      const res = await fetch(`/api/wallet/check/${encodeURIComponent(u)}`);
      const data = await res.json();
      if (!data.has_pin) {
        // No PIN yet → redirect to wallet page to set up
        handleClose();
        setLocation("/wallet");
        return;
      }
      setMiniStep("pin");
    } catch {
      setMiniError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    } finally {
      setMiniLoading(false);
    }
  };

  const handleMiniAuth = async () => {
    const u = inputUsername.replace(/^@/, "").trim().toLowerCase();
    setMiniLoading(true); setMiniError("");
    try {
      const res = await fetch("/api/wallet/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "เกิดข้อผิดพลาด");
      sessionStorage.setItem("wallet_token", data.token);
      setToken(data.token);
      setPin(""); setMiniStep("username");
    } catch (e: any) {
      setMiniError(e.message);
      setPin("");
    } finally {
      setMiniLoading(false);
    }
  };

  const price = product ? parseFloat(product.price) : 0;
  const balance = walletQuery.data?.balance ?? 0;
  const walletUsername = walletQuery.data?.username ?? "";
  const hasEnough = balance >= price;

  return (
    <Dialog open={!!product} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-md">
        {result ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle size={52} className="text-green-400" />
            <div>
              <h3 className="font-bold text-lg text-foreground">ซื้อสำเร็จ!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                เครดิตคงเหลือ <span className="text-foreground font-semibold">{result.balance.toLocaleString("th-TH")} เครดิต</span>
              </p>
            </div>
            {result.invite_links.length > 0 && (
              <div className="w-full bg-muted/50 border border-border rounded-xl p-4 text-left space-y-2">
                <p className="text-xs font-medium text-muted-foreground">ลิงก์เข้ากลุ่ม (ใช้ได้ครั้งเดียว)</p>
                {result.invite_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                    className="block w-full text-center bg-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold hover:bg-primary/90 transition-colors">
                    เข้ากลุ่ม {result.invite_links.length > 1 ? `(${i + 1})` : ""}
                  </a>
                ))}
              </div>
            )}
            {result.invite_links.length === 0 && (
              <div className="w-full bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
                แอดมินจะส่งลิงก์ให้เร็วๆ นี้ ออเดอร์ #{result.order_id}
              </div>
            )}
            <Button onClick={handleClose} className="w-full">ปิด</Button>
          </motion.div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground">{product?.name}</DialogTitle>
              <p className="text-primary font-bold text-xl">{price.toLocaleString("th-TH")} เครดิต</p>
            </DialogHeader>

            {/* Not logged in → mini login */}
            {!isTokenValid && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
                  <Lock size={12} className="shrink-0" />
                  <span>กรุณาเข้าสู่ระบบกระเป๋าเครดิตก่อนซื้อ</span>
                </div>

                {miniStep === "username" && (
                  <>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                      <input
                        className="w-full bg-muted border border-border rounded-lg pl-7 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Telegram username ของคุณ"
                        value={inputUsername.replace(/^@/, "")}
                        onChange={e => setInputUsername(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleMiniCheckUser()}
                        disabled={miniLoading}
                      />
                    </div>
                    {miniError && <p className="text-red-400 text-xs">{miniError}</p>}
                    <Button className="w-full" onClick={handleMiniCheckUser} disabled={!inputUsername.trim() || miniLoading}>
                      {miniLoading ? <Loader size={14} className="animate-spin" /> : "ต่อไป"}
                    </Button>
                    <button onClick={() => { handleClose(); setLocation("/wallet"); }}
                      className="w-full text-xs text-muted-foreground hover:text-primary text-center transition-colors">
                      ยังไม่มีบัญชี? สมัครที่กระเป๋าเครดิต →
                    </button>
                  </>
                )}

                {miniStep === "pin" && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        PIN ของ @{inputUsername.replace(/^@/, "")}
                      </label>
                      <div className="relative">
                        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          className="w-full bg-muted border border-border rounded-lg pl-9 pr-10 py-2.5 text-sm text-foreground tracking-widest focus:outline-none focus:ring-1 focus:ring-primary"
                          type={showPin ? "text" : "password"}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="● ● ● ●"
                          value={pin}
                          disabled={miniLoading}
                          onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onKeyDown={e => e.key === "Enter" && handleMiniAuth()}
                          autoFocus
                        />
                        <button type="button" tabIndex={-1}
                          onClick={() => setShowPin(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    {miniError && <p className="text-red-400 text-xs">{miniError}</p>}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setMiniStep("username"); setPin(""); setMiniError(""); }}>
                        ← กลับ
                      </Button>
                      <Button className="flex-1" onClick={handleMiniAuth} disabled={pin.length < 4 || miniLoading}>
                        {miniLoading ? <Loader size={14} className="animate-spin" /> : "เข้าสู่ระบบ"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Logged in → show balance and buy button */}
            {isTokenValid && (
              <div className="space-y-4 pt-1">
                {walletQuery.isLoading ? (
                  <div className="h-16 bg-muted animate-pulse rounded-xl" />
                ) : (
                  <div className="bg-muted rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">บัญชี @{walletUsername}</p>
                      <p className={`text-lg font-bold ${hasEnough ? "text-foreground" : "text-red-400"}`}>
                        {balance.toLocaleString("th-TH")} เครดิต
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground mb-0.5">ราคาสินค้า</p>
                      <p className="text-lg font-bold text-primary">{price.toLocaleString("th-TH")}</p>
                    </div>
                  </div>
                )}

                {!hasEnough && !walletQuery.isLoading && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-center justify-between">
                    <span>เครดิตไม่พอ (ขาด {(price - balance).toLocaleString("th-TH")} เครดิต)</span>
                    <button onClick={() => { handleClose(); setLocation("/wallet"); }} className="text-xs underline whitespace-nowrap ml-2">
                      เติมเงิน
                    </button>
                  </div>
                )}

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-red-400">{error}</div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs"
                    onClick={() => { sessionStorage.removeItem("wallet_token"); setToken(""); setMiniStep("username"); setError(""); }}>
                    เปลี่ยนบัญชี
                  </Button>
                  <Button className="flex-1 font-bold"
                    disabled={!hasEnough || purchaseMutation.isPending || walletQuery.isLoading}
                    onClick={() => { setError(""); purchaseMutation.mutate(); }}>
                    {purchaseMutation.isPending ? <Loader size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                    {purchaseMutation.isPending ? "กำลังดำเนินการ..." : `ซื้อ ${price.toLocaleString()} เครดิต`}
                  </Button>
                </div>

                <button onClick={() => { handleClose(); setLocation("/wallet"); }}
                  className="w-full text-xs text-muted-foreground hover:text-primary flex items-center justify-center gap-1.5 transition-colors">
                  <Wallet size={12} /> ดูกระเป๋าเครดิต / เติมเงิน
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteLinksList({ inviteLinks }: { inviteLinks: string }) {
  let links: string[] = [];
  try { links = JSON.parse(inviteLinks); } catch {}
  if (links.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-green-300 flex items-center gap-1.5">
        <CheckCircle size={15} /> ลิงก์เข้ากลุ่มพร้อมแล้ว!
      </p>
      <p className="text-xs text-muted-foreground">กดลิงก์ด้านล่างเพื่อเข้ากลุ่ม (ใช้ได้ครั้งเดียว ห้ามแชร์)</p>
      {links.map((link, i) => (
        <a key={i} href={link} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 bg-[#229ED9]/15 border border-[#229ED9]/40 hover:border-[#229ED9] rounded-lg px-4 py-3 transition-colors">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#229ED9] shrink-0">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.29 13.91l-2.957-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.855.649z" />
          </svg>
          <span className="text-[#229ED9] font-medium text-sm">
            {links.length > 1 ? `เข้ากลุ่มที่ ${i + 1}` : "กดเพื่อเข้ากลุ่ม Telegram"}
          </span>
          <ChevronRight size={14} className="ml-auto text-[#229ED9]" />
        </a>
      ))}
    </div>
  );
}

function OrderStatusCard({ result }: { result: OrderStatus }) {
  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; desc: string }> = {
    pending: { icon: <Loader size={28} className="animate-spin text-yellow-400" />, label: "รอการยืนยัน", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30", desc: "แอดมินกำลังตรวจสอบหลักฐานการชำระเงิน กรุณารอสักครู่" },
    approved: { icon: <CheckCircle size={28} className="text-green-400" />, label: "อนุมัติแล้ว", color: "text-green-400", bg: "bg-green-500/10 border-green-500/30", desc: "" },
    rejected: { icon: <XCircle size={28} className="text-red-400" />, label: "ไม่ได้รับการอนุมัติ", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", desc: "กรุณาติดต่อแอดมินหากคิดว่าเกิดข้อผิดพลาด" },
  };
  const cfg = statusConfig[result.status] ?? statusConfig.pending;
  const hasLinks = result.invite_links && (() => { try { return JSON.parse(result.invite_links!).length > 0; } catch { return false; } })();

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`border rounded-xl p-4 flex flex-col gap-3 ${cfg.bg}`}>
      <div className="flex items-center gap-3">
        {cfg.icon}
        <div>
          <p className={`font-bold text-lg ${cfg.color}`}>{cfg.label}</p>
          <p className="text-xs text-muted-foreground">ออเดอร์ #{result.id} · {result.product_name}</p>
        </div>
      </div>
      {result.status === "approved" && (
        <div className="flex flex-col gap-3 pt-2 border-t border-border/50">
          {hasLinks ? (
            <InviteLinksList inviteLinks={result.invite_links!} />
          ) : (
            <div className="flex items-start gap-2">
              <Loader size={16} className="text-yellow-400 shrink-0 mt-0.5 animate-spin" />
              <div>
                <p className="text-sm text-yellow-300 font-medium">กำลังเตรียมลิงก์เข้ากลุ่ม</p>
                <p className="text-xs text-muted-foreground mt-0.5">ลองกดตรวจสอบใหม่สักครู่ หากรอนานกว่า 10 นาที ติดต่อแอดมิน</p>
              </div>
            </div>
          )}
        </div>
      )}
      {(result.status === "rejected" || result.status === "pending") && cfg.desc && (
        <p className="text-sm text-muted-foreground pt-1 border-t border-border/50">{cfg.desc}</p>
      )}
      <p className="text-xs text-muted-foreground/60">
        สั่งซื้อเมื่อ: {result.created_at ? new Date(result.created_at).toLocaleString("th-TH") : "—"}
      </p>
    </motion.div>
  );
}

function OrderStatusModal({ open, initialOrderId, initialName, initialPhone, onClose }: {
  open: boolean;
  initialOrderId?: number | null;
  initialName?: string;
  initialPhone?: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"id" | "phone">("id");
  const [orderId, setOrderId] = useState(initialOrderId ? String(initialOrderId) : "");
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [result, setResult] = useState<OrderStatus | null>(null);
  const [phoneResults, setPhoneResults] = useState<OrderStatus[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialOrderId) {
        setOrderId(String(initialOrderId));
        setName(initialName || "");
        setPhone(initialPhone || "");
      }
      setResult(null); setPhoneResults([]); setError("");
    }
  }, [open, initialOrderId, initialName, initialPhone]);

  const handleCheck = async () => {
    setError(""); setResult(null);
    if (!orderId.trim()) { setError("กรุณากรอกหมายเลขออเดอร์"); return; }
    if (!name.trim() && !phone.trim()) { setError("กรุณากรอกชื่อหรือเบอร์โทรเพื่อยืนยัน"); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (name.trim()) params.append("name", name.trim());
      if (phone.trim()) params.append("phone", phone.trim());
      const res = await fetch(`/api/orders/${orderId}/status?${params}`);
      if (res.status === 404) { setError("ไม่พบออเดอร์นี้ กรุณาตรวจสอบหมายเลขออเดอร์"); setLoading(false); return; }
      if (res.status === 403) { setError("ชื่อหรือเบอร์โทรไม่ตรงกับออเดอร์นี้"); setLoading(false); return; }
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.detail || "เกิดข้อผิดพลาด กรุณาลองใหม่"); setLoading(false); return; }
      setResult(await res.json());
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); }
    setLoading(false);
  };

  const handlePhoneSearch = async () => {
    setError(""); setPhoneResults([]);
    if (!phoneSearch.trim()) { setError("กรุณากรอกเบอร์โทร"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/by-phone?phone=${encodeURIComponent(phoneSearch.trim())}`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.detail || "เกิดข้อผิดพลาด"); setLoading(false); return; }
      const data = await res.json();
      if (data.length === 0) setError("ไม่พบออเดอร์ที่ใช้เบอร์นี้");
      else setPhoneResults(data);
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Search size={18} className="text-primary" />
            ตรวจสอบสถานะออเดอร์
          </DialogTitle>
        </DialogHeader>

        <div className="flex rounded-lg bg-muted p-1 gap-1 mb-1">
          <button onClick={() => { setMode("id"); setError(""); setPhoneResults([]); setResult(null); }}
            className={`flex-1 text-sm py-1.5 rounded-md font-medium transition-colors ${mode === "id" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
            ค้นหาด้วยเลขออเดอร์
          </button>
          <button onClick={() => { setMode("phone"); setError(""); setResult(null); }}
            className={`flex-1 text-sm py-1.5 rounded-md font-medium transition-colors ${mode === "phone" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
            ค้นหาด้วยเบอร์โทร
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {mode === "id" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">หมายเลขออเดอร์</label>
                  <input type="number" placeholder="เช่น 42" value={orderId}
                    onChange={(e) => { setOrderId(e.target.value); setResult(null); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ชื่อ หรือ เบอร์โทร</label>
                  <input type="text" placeholder="ชื่อ หรือ 0812345678" value={name || phone}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^\d/.test(v)) { setPhone(v); setName(""); }
                      else { setName(v); setPhone(""); }
                      setResult(null); setError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
                </div>
              </div>
              <Button onClick={handleCheck} disabled={loading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2">
                {loading ? <><Loader size={14} className="animate-spin" /> กำลังตรวจสอบ...</> : <><Search size={14} /> ตรวจสอบสถานะ</>}
              </Button>
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3"><p className="text-red-400 text-sm">{error}</p></div>}
              {result && <OrderStatusCard result={result} />}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">เบอร์โทรที่ใช้สั่ง</label>
                <input type="tel" placeholder="0812345678" value={phoneSearch}
                  onChange={(e) => { setPhoneSearch(e.target.value); setPhoneResults([]); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handlePhoneSearch()}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <Button onClick={handlePhoneSearch} disabled={loading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2">
                {loading ? <><Loader size={14} className="animate-spin" /> กำลังค้นหา...</> : <><Search size={14} /> ค้นหาออเดอร์</>}
              </Button>
              {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3"><p className="text-red-400 text-sm">{error}</p></div>}
              {phoneResults.length > 0 && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">พบ {phoneResults.length} ออเดอร์</p>
                  {phoneResults.map((r) => <OrderStatusCard key={r.id} result={r} />)}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StoreFront() {
  const [, setLocation] = useLocation();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showOrderStatus, setShowOrderStatus] = useState(false);
  const [checkOrderId, setCheckOrderId] = useState<number | null>(null);
  const [checkName, setCheckName] = useState("");
  const [checkPhone, setCheckPhone] = useState("");

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => fetch("/api/products").then((r) => r.json()),
  });

  const { data: settings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => fetch("/api/store-settings").then((r) => r.json()),
  });

  const { data: announcements = [] } = useQuery<{ id: number }[]>({
    queryKey: ["announcements"],
    queryFn: () => fetch("/api/announcements").then((r) => r.json()),
  });

  const [seenIds, setSeenIds] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("seen_announcements") || "[]"); } catch { return []; }
  });

  const hasUnread = announcements.some((a) => !seenIds.includes(a.id));

  const markAllSeen = () => {
    const ids = announcements.map((a) => a.id);
    setSeenIds(ids);
    localStorage.setItem("seen_announcements", JSON.stringify(ids));
  };

  const storeName = settings?.store_name || "DigitalStore";
  const heroTitle = settings?.hero_title || "สินค้าดิจิทัลพรีเมียม";
  const heroSubtitle = settings?.hero_subtitle || "รับสิทธิ์ทันทีผ่าน Telegram — ชำระเงิน รอยืนยัน รับลิงก์";
  const announcement = settings?.announcement || "";
  const botUsername = settings?.bot_username || "";
  const bankName = settings?.bank_name || "";
  const bankAccount = settings?.bank_account || "";
  const bankQrUrl = settings?.bank_qr_url || "";

  // Wallet balance in header
  const [headerToken] = useState(() => sessionStorage.getItem("wallet_token") || "");
  const { data: headerWallet } = useQuery<{ username: string; balance: number }>({
    queryKey: ["wallet-header", headerToken],
    queryFn: async () => {
      const res = await fetch("/api/wallet/me", { headers: { Authorization: `Bearer ${headerToken}` } });
      if (!res.ok) throw new Error("no wallet");
      return res.json();
    },
    enabled: !!headerToken,
    staleTime: 60_000,
    retry: false,
  });

  const handleBuySuccess = (orderId: number, name: string, phone: string) => {
    setCheckOrderId(orderId);
    setCheckName(name);
    setCheckPhone(phone);
    setShowOrderStatus(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <Zap size={18} className="text-primary shrink-0" />
            <span className="font-bold text-foreground tracking-tight truncate max-w-[120px] sm:max-w-none">{storeName}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Wallet button — always visible, shows balance when logged in */}
            <button
              onClick={() => setLocation("/wallet")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                headerWallet
                  ? "bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25"
                  : "bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              <Wallet size={13} />
              {headerWallet
                ? <span>{headerWallet.balance.toLocaleString("th-TH")} <span className="hidden xs:inline">เครดิต</span></span>
                : <span>กระเป๋า</span>
              }
            </button>
            <button
              onClick={() => { markAllSeen(); setLocation("/announcements"); }}
              className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted border border-border hover:border-primary/40 transition-colors"
            >
              <Megaphone size={13} /> <span className="hidden sm:inline">ประกาศ</span>
              {hasUnread && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-background" />
              )}
            </button>
          </div>
        </div>
      </header>

      {announcement && (
        <button
          onClick={() => setLocation("/announcements")}
          className="w-full bg-yellow-500/10 border-b border-yellow-500/30 hover:bg-yellow-500/15 transition-colors text-left overflow-hidden"
        >
          <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
            <Megaphone size={15} className="text-yellow-400 shrink-0" />
            <div className="flex-1 overflow-hidden">
              <span className="animate-marquee text-sm text-yellow-200">
                {announcement}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{announcement}
              </span>
            </div>
            <ChevronRight size={14} className="text-yellow-400/60 shrink-0" />
          </div>
        </button>
      )}

      <div className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-6xl mx-auto px-4 py-12 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
          >
            {heroTitle}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground mt-2 max-w-md mx-auto"
          >
            {heroSubtitle}
          </motion.p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-10">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl h-64 animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <ShoppingBag size={36} className="mx-auto mb-3 opacity-40" />
            <p>ยังไม่มีสินค้าในขณะนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {products.map((product, i) => (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <ProductCard product={product} onBuy={setSelectedProduct} />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <BuyModal
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
      />
      <OrderStatusModal
        open={showOrderStatus}
        initialOrderId={checkOrderId}
        initialName={checkName}
        initialPhone={checkPhone}
        onClose={() => { setShowOrderStatus(false); setCheckOrderId(null); setCheckName(""); setCheckPhone(""); }}
      />
    </div>
  );
}
