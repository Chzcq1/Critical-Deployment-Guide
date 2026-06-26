import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, X, Upload, Link, Clock, LogOut, ChevronRight, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TelegramLoginWidget } from "@/components/TelegramLoginWidget";

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME || "your_bot";

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  fake_discount_price: string | null;
  image_url: string | null;
  is_active: boolean;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
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
            Buy
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function BuyModal({
  product,
  user,
  onClose,
}: {
  product: Product | null;
  user: TelegramUser | null;
  onClose: () => void;
}) {
  const [paymentType, setPaymentType] = useState<"slip" | "truemoney">("slip");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [trueMoneyLink, setTrueMoneyLink] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!product || !user) return;
      let paymentProof = trueMoneyLink;
      if (paymentType === "slip" && slipFile) {
        paymentProof = `[Image: ${slipFile.name}]`;
      }
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegram_user_id: user.id,
          telegram_username: user.username || null,
          telegram_first_name: user.first_name,
          product_id: product.id,
          payment_proof: paymentProof,
          payment_type: paymentType,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit order");
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: () => setError("Failed to submit. Please try again."),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipFile(file);
    const url = URL.createObjectURL(file);
    setSlipPreview(url);
  };

  const handleSubmit = () => {
    setError("");
    if (paymentType === "slip" && !slipFile) {
      setError("Please upload your payment slip.");
      return;
    }
    if (paymentType === "truemoney" && !trueMoneyLink.trim()) {
      setError("Please paste your TrueMoney link.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={!!product} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-4 py-6 text-center"
          >
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Shield size={24} className="text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">Payment Submitted</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Our bot will send you access via Telegram DM once approved.
              </p>
            </div>
            <Button variant="outline" onClick={onClose} className="w-full">
              Close
            </Button>
          </motion.div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-foreground">
                {product?.name}
              </DialogTitle>
              <p className="text-primary font-bold text-xl">
                ฿{product ? parseFloat(product.price).toLocaleString() : ""}
              </p>
            </DialogHeader>

            <Tabs value={paymentType} onValueChange={(v) => setPaymentType(v as "slip" | "truemoney")}>
              <TabsList className="w-full bg-muted">
                <TabsTrigger value="slip" className="flex-1 gap-2">
                  <Upload size={14} /> Payment Slip
                </TabsTrigger>
                <TabsTrigger value="truemoney" className="flex-1 gap-2">
                  <Link size={14} /> TrueMoney
                </TabsTrigger>
              </TabsList>

              <TabsContent value="slip" className="mt-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                >
                  {slipPreview ? (
                    <img src={slipPreview} alt="slip" className="max-h-40 mx-auto rounded object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Upload size={24} />
                      <span className="text-sm">Click to upload payment slip</span>
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </TabsContent>

              <TabsContent value="truemoney" className="mt-4">
                <input
                  type="text"
                  placeholder="https://gift.truemoney.com/..."
                  value={trueMoneyLink}
                  onChange={(e) => setTrueMoneyLink(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </TabsContent>
            </Tabs>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <Button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              {mutation.isPending ? "Submitting..." : "Submit Payment"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LoginPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in with Telegram</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You need to sign in with Telegram to make a purchase.
        </p>
        <div className="flex justify-center py-2">
          <TelegramLoginWidget
            botName={BOT_USERNAME}
            onAuth={(user) => {
              fetch("/api/auth/telegram", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(user),
              })
                .then((r) => r.json())
                .then((verified) => {
                  localStorage.setItem("tg_user", JSON.stringify(verified));
                  window.location.reload();
                })
                .catch(() => {});
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function StoreFront() {
  const [user, setUser] = useState<TelegramUser | null>(() => {
    try {
      const stored = localStorage.getItem("tg_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => fetch("/api/products").then((r) => r.json()),
  });

  const handleBuy = (product: Product) => {
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }
    setSelectedProduct(product);
  };

  const handleLogout = () => {
    localStorage.removeItem("tg_user");
    setUser(null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-primary" />
            <span className="font-bold text-foreground tracking-tight">DigitalStore</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2">
                {user.photo_url && (
                  <img src={user.photo_url} alt="" className="w-7 h-7 rounded-full" />
                )}
                <span className="text-sm text-muted-foreground hidden sm:block">
                  {user.first_name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleLogout}
                  className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                >
                  <LogOut size={14} />
                </Button>
              </div>
            ) : (
              <TelegramLoginWidget
                botName={BOT_USERNAME}
                buttonSize="small"
                onAuth={(u) => {
                  fetch("/api/auth/telegram", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(u),
                  })
                    .then((r) => r.json())
                    .then((verified) => {
                      localStorage.setItem("tg_user", JSON.stringify(verified));
                      setUser(verified);
                    })
                    .catch(() => {});
                }}
              />
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-6xl mx-auto px-4 py-12 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight"
          >
            Premium Digital Products
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground mt-2 max-w-md mx-auto"
          >
            Instant access delivered via Telegram. Pay, get approved, receive your link.
          </motion.p>
        </div>
      </div>

      {/* Products */}
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
            <p>No products available yet.</p>
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
                <ProductCard product={product} onBuy={handleBuy} />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <BuyModal
        product={selectedProduct}
        user={user}
        onClose={() => setSelectedProduct(null)}
      />
      <LoginPromptModal
        open={showLoginPrompt}
        onClose={() => setShowLoginPrompt(false)}
      />
    </div>
  );
}
