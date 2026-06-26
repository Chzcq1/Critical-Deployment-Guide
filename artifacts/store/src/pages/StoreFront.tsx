import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ShoppingBag, Upload, Link, Clock, ChevronRight, Zap, Megaphone, Search, CheckCircle, XCircle, Loader } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  fake_discount_price: string | null;
  image_url: string | null;
  is_active: boolean;
}

interface StoreSettings {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  store_name: string;
  bot_username: string;
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="group relative flex flex-col bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 transition-colors"
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Zap size={32} className="text-primary/30" />
          </div>
        )}
        {hasDiscount && (
          <div className="absolute top-2 left-2">
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
  botUsername,
  onClose,
  onSuccess,
}: {
  product: Product | null;
  botUsername: string;
  onClose: () => void;
  onSuccess: (orderId: number, customerName: string) => void;
}) {
  const [step, setStep] = useState<"info" | "payment">("info");
  const [customerName, setCustomerName] = useState("");
  const [paymentType, setPaymentType] = useState<"slip" | "truemoney">("slip");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [trueMoneyLink, setTrueMoneyLink] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!product) return;
      let paymentProof = trueMoneyLink;
      if (paymentType === "slip" && slipFile) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(slipFile);
        });
        paymentProof = base64;
      }
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_user_id: null,
          telegram_username: null,
          telegram_first_name: customerName,
          product_id: product.id,
          payment_proof: paymentProof,
          payment_type: paymentType,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit order");
      return res.json();
    },
    onSuccess: (data) => {
      setOrderId(data.id);
      setSubmitted(true);
    },
    onError: () => setError("ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipFile(file);
    setSlipPreview(URL.createObjectURL(file));
  };

  const handleNextStep = () => {
    setError("");
    if (!customerName.trim()) { setError("กรุณากรอกชื่อของคุณ"); return; }
    setStep("payment");
  };

  const handleSubmit = () => {
    setError("");
    if (paymentType === "slip" && !slipFile) { setError("กรุณาแนบสลีปการโอนเงิน"); return; }
    if (paymentType === "truemoney" && !trueMoneyLink.trim()) { setError("กรุณาวางลิงก์ซองทรูมันนี่"); return; }
    mutation.mutate();
  };

  const handleClose = () => {
    setStep("info"); setCustomerName("");
    setSlipFile(null); setSlipPreview(null); setTrueMoneyLink("");
    setSubmitted(false); setOrderId(null); setError("");
    onClose();
  };

  const handleCheckStatus = () => {
    if (orderId !== null) {
      handleClose();
      onSuccess(orderId, customerName);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-md">
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-4 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="text-3xl">✅</span>
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">ส่งหลักฐานสำเร็จ!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                แอดมินกำลังตรวจสอบ รอสักครู่นะครับ
              </p>
            </div>

            <div className="w-full bg-muted/50 border border-border rounded-xl p-4 text-left">
              <p className="text-xs text-muted-foreground mb-1">หมายเลขออเดอร์ของคุณ</p>
              <p className="text-2xl font-bold font-mono text-primary">#{orderId}</p>
              <p className="text-xs text-muted-foreground mt-2">
                📌 บันทึกเลขนี้ไว้ — กด "ตรวจสอบสถานะ" เพื่อดูว่าอนุมัติหรือยัง และรับลิงก์เข้ากลุ่มได้เลย
              </p>
            </div>

            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleClose} className="flex-1 text-sm">ปิด</Button>
              <Button onClick={handleCheckStatus} className="flex-1 bg-primary text-primary-foreground gap-1 text-sm font-bold">
                <Search size={13} /> ตรวจสอบสถานะ
              </Button>
            </div>
          </motion.div>
        ) : step === "info" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground">{product?.name}</DialogTitle>
              <p className="text-primary font-bold text-xl">
                ฿{product ? parseFloat(product.price).toLocaleString() : ""}
              </p>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ชื่อ-นามสกุล *</label>
                <input
                  type="text"
                  placeholder="กรอกชื่อของคุณ"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleNextStep()}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <Button onClick={handleNextStep} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                ถัดไป — แนบหลักฐาน <ChevronRight size={14} />
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground">แนบหลักฐานการชำระเงิน</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {product?.name} — ฿{product ? parseFloat(product.price).toLocaleString() : ""}
              </p>
            </DialogHeader>
            <Tabs value={paymentType} onValueChange={(v) => setPaymentType(v as "slip" | "truemoney")}>
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="slip" className="flex-1 gap-2"><Upload size={14} /> สลีปโอนเงิน</TabsTrigger>
                <TabsTrigger value="truemoney" className="flex-1 gap-2"><Link size={14} /> TrueMoney</TabsTrigger>
              </TabsList>
              <TabsContent value="slip" className="mt-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  {slipPreview ? (
                    <img src={slipPreview} alt="slip" className="max-h-48 mx-auto rounded object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload size={24} />
                      <span className="text-sm">แตะเพื่ออัปโหลดสลีป</span>
                      <span className="text-xs text-muted-foreground/60">รองรับ JPG, PNG</span>
                    </div>
                  )}
                </div>
                <input type="file" ref={fileInputRef} accept="image/*" onChange={handleFileChange} className="hidden" />
                {slipPreview && (
                  <button onClick={() => { setSlipFile(null); setSlipPreview(null); }} className="mt-2 text-xs text-muted-foreground hover:text-red-400 transition-colors">
                    ✕ เปลี่ยนรูป
                  </button>
                )}
              </TabsContent>
              <TabsContent value="truemoney" className="mt-4">
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="https://gift.truemoney.com/..."
                    value={trueMoneyLink}
                    onChange={(e) => setTrueMoneyLink(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                  <p className="text-xs text-muted-foreground">วางลิงก์ซองทรูมันนี่ที่นี่</p>
                </div>
              </TabsContent>
            </Tabs>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep("info"); setError(""); }} className="flex-1">ย้อนกลับ</Button>
              <Button onClick={handleSubmit} disabled={mutation.isPending} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
                {mutation.isPending ? "กำลังส่ง..." : "ส่งหลักฐาน"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrderStatusModal({ open, initialOrderId, initialName, onClose }: {
  open: boolean;
  initialOrderId?: number | null;
  initialName?: string;
  onClose: () => void;
}) {
  const [orderId, setOrderId] = useState(initialOrderId ? String(initialOrderId) : "");
  const [name, setName] = useState(initialName || "");
  const [result, setResult] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && initialOrderId) {
      setOrderId(String(initialOrderId));
      setName(initialName || "");
      setResult(null);
      setError("");
    }
  }, [open, initialOrderId, initialName]);

  const handleCheck = async () => {
    setError(""); setResult(null);
    if (!orderId.trim() || !name.trim()) { setError("กรุณากรอกข้อมูลให้ครบ"); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/status?name=${encodeURIComponent(name.trim())}`);
      if (res.status === 404) { setError("ไม่พบออเดอร์นี้ กรุณาตรวจสอบหมายเลขออเดอร์"); setLoading(false); return; }
      if (res.status === 403) { setError("ชื่อไม่ตรงกับออเดอร์นี้ กรุณาตรวจสอบอีกครั้ง"); setLoading(false); return; }
      if (!res.ok) { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); setLoading(false); return; }
      const data = await res.json();
      setResult(data);
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่");
    }
    setLoading(false);
  };

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string; desc: string }> = {
    pending: {
      icon: <Loader size={28} className="animate-spin text-yellow-400" />,
      label: "รอการยืนยัน",
      color: "text-yellow-400",
      bg: "bg-yellow-500/10 border-yellow-500/30",
      desc: "แอดมินกำลังตรวจสอบหลักฐานการชำระเงิน กรุณารอสักครู่",
    },
    approved: {
      icon: <CheckCircle size={28} className="text-green-400" />,
      label: "อนุมัติแล้ว",
      color: "text-green-400",
      bg: "bg-green-500/10 border-green-500/30",
      desc: "",
    },
    rejected: {
      icon: <XCircle size={28} className="text-red-400" />,
      label: "ไม่ได้รับการอนุมัติ",
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/30",
      desc: "กรุณาติดต่อแอดมินหากคิดว่าเกิดข้อผิดพลาด",
    },
  };

  const cfg = result ? (statusConfig[result.status] ?? statusConfig.pending) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Search size={18} className="text-primary" />
            ตรวจสอบสถานะออเดอร์
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">หมายเลขออเดอร์</label>
              <input
                type="number"
                placeholder="เช่น 42"
                value={orderId}
                onChange={(e) => { setOrderId(e.target.value); setResult(null); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ชื่อที่ใช้สั่ง</label>
              <input
                type="text"
                placeholder="ชื่อของคุณ"
                value={name}
                onChange={(e) => { setName(e.target.value); setResult(null); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleCheck()}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <Button onClick={handleCheck} disabled={loading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-2">
            {loading ? <><Loader size={14} className="animate-spin" /> กำลังตรวจสอบ...</> : <><Search size={14} /> ตรวจสอบสถานะ</>}
          </Button>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {result && cfg && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`border rounded-xl p-4 flex flex-col gap-3 ${cfg.bg}`}
            >
              <div className="flex items-center gap-3">
                {cfg.icon}
                <div>
                  <p className={`font-bold text-lg ${cfg.color}`}>{cfg.label}</p>
                  <p className="text-xs text-muted-foreground">ออเดอร์ #{result.id} · {result.product_name}</p>
                </div>
              </div>

              {result.status === "approved" && (
                <div className="flex flex-col gap-3 pt-2 border-t border-border/50">
                  {result.invite_links ? (
                    (() => {
                      let links: string[] = [];
                      try { links = JSON.parse(result.invite_links); } catch { links = []; }
                      return links.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-semibold text-green-300 flex items-center gap-1.5">
                            <CheckCircle size={15} /> ลิงก์เข้ากลุ่มพร้อมแล้ว!
                          </p>
                          <p className="text-xs text-muted-foreground">กดลิงก์ด้านล่างเพื่อเข้ากลุ่ม (ใช้ได้ครั้งเดียว ห้ามแชร์)</p>
                          {links.map((link, i) => (
                            <a
                              key={i}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 bg-[#229ED9]/15 border border-[#229ED9]/40 hover:border-[#229ED9] rounded-lg px-4 py-3 transition-colors"
                            >
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
                      ) : (
                        <div className="flex items-start gap-2">
                          <Loader size={16} className="text-yellow-400 shrink-0 mt-0.5 animate-spin" />
                          <p className="text-sm text-yellow-300">กำลังเตรียมลิงก์ กรุณาลองตรวจสอบใหม่อีกครั้ง</p>
                        </div>
                      );
                    })()
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

              {result.status === "rejected" && (
                <p className="text-sm text-muted-foreground pt-1 border-t border-border/50">{cfg.desc}</p>
              )}

              {result.status === "pending" && (
                <p className="text-sm text-muted-foreground pt-1 border-t border-border/50">{cfg.desc}</p>
              )}

              <p className="text-xs text-muted-foreground/60">
                สั่งซื้อเมื่อ: {result.created_at ? new Date(result.created_at).toLocaleString("th-TH") : "—"}
              </p>
            </motion.div>
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

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => fetch("/api/products").then((r) => r.json()),
  });

  const { data: settings } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => fetch("/api/store-settings").then((r) => r.json()),
  });

  const storeName = settings?.store_name || "DigitalStore";
  const heroTitle = settings?.hero_title || "สินค้าดิจิทัลพรีเมียม";
  const heroSubtitle = settings?.hero_subtitle || "รับสิทธิ์ทันทีผ่าน Telegram — ชำระเงิน รอยืนยัน รับลิงก์";
  const announcement = settings?.announcement || "";
  const botUsername = settings?.bot_username || "";

  const handleBuySuccess = (orderId: number, name: string) => {
    setCheckOrderId(orderId);
    setCheckName(name);
    setShowOrderStatus(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <Zap size={18} className="text-primary" />
            <span className="font-bold text-foreground tracking-tight">{storeName}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLocation("/announcements")}
              className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
            >
              <Megaphone size={13} /> ประกาศ
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setCheckOrderId(null); setCheckName(""); setShowOrderStatus(true); }}
              className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
            >
              <Search size={13} /> ตรวจสอบออเดอร์
            </Button>
          </div>
        </div>
      </header>

      {announcement && (
        <button
          onClick={() => setLocation("/announcements")}
          className="w-full bg-yellow-500/10 border-b border-yellow-500/30 hover:bg-yellow-500/15 transition-colors text-left"
        >
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <Megaphone size={16} className="text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-200 line-clamp-1 flex-1">{announcement}</p>
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
        botUsername={botUsername}
        onClose={() => setSelectedProduct(null)}
        onSuccess={handleBuySuccess}
      />
      <OrderStatusModal
        open={showOrderStatus}
        initialOrderId={checkOrderId}
        initialName={checkName}
        onClose={() => { setShowOrderStatus(false); setCheckOrderId(null); setCheckName(""); }}
      />
    </div>
  );
}
