import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, Package, ClipboardList, LogOut, Shield, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Product {
  id: number;
  name: string;
  description: string | null;
  price: string;
  fake_discount_price: string | null;
  image_url: string | null;
  telegram_group_ids: string | null;
  is_active: boolean;
}

interface Order {
  id: number;
  telegram_user_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
  product_name: string;
  payment_type: string;
  status: string;
  created_at: string;
}

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-green-500/20 text-green-400 border-green-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${map[status] || ""}`}>
      {status}
    </span>
  );
}

function ProductFormModal({
  product,
  token,
  onClose,
}: {
  product: Product | null;
  token: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!product;
  const [form, setForm] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: product?.price ?? "",
    fake_discount_price: product?.fake_discount_price ?? "",
    image_url: product?.image_url ?? "",
    telegram_group_ids: product?.telegram_group_ids ?? "",
    is_active: product?.is_active ?? true,
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        description: form.description || null,
        price: parseFloat(form.price),
        fake_discount_price: form.fake_discount_price ? parseFloat(form.fake_discount_price) : null,
        image_url: form.image_url || null,
        telegram_group_ids: form.telegram_group_ids || null,
        is_active: form.is_active,
      };
      const url = isEdit ? `/api/admin/products/${product!.id}` : "/api/admin/products";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to save product");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-products"] });
      onClose();
    },
    onError: () => setError("Failed to save product. Check all required fields."),
  });

  const field = (label: string, key: keyof typeof form, placeholder = "", type = "text") => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[key] as string}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
      />
    </div>
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Product" : "Add Product"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {field("Product Name *", "name", "e.g. Trading Signals Bundle")}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</label>
            <textarea
              placeholder="Describe what the customer gets..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("Price (฿) *", "price", "500", "number")}
            {field("Fake Discount Price (฿)", "fake_discount_price", "799", "number")}
          </div>
          {field("Image URL", "image_url", "https://...")}
          {field("Telegram Group IDs", "telegram_group_ids", "-100123456789,-100987654321")}
          <p className="text-xs text-muted-foreground -mt-1">
            Comma-separated group IDs. The bot will generate single-use invite links for each group.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.is_active ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.is_active ? "translate-x-5" : ""}`}
              />
            </button>
            <span className="text-sm text-foreground">{form.is_active ? "Active" : "Inactive"}</span>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name || !form.price}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold mt-1"
          >
            {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductsTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Product | null | "new">(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["admin-products"],
    queryFn: () =>
      fetch("/api/admin/products", { headers: authHeaders(token) }).then((r) => {
        if (r.status === 401) throw new Error("Unauthorized");
        return r.json();
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/products/${id}`, { method: "DELETE", headers: authHeaders(token) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-products"] }),
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm text-muted-foreground">{products.length} products</h2>
        <Button size="sm" onClick={() => setEditing("new")} className="bg-primary text-primary-foreground gap-1">
          <Plus size={14} /> Add Product
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No products yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {products.map((p) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/30 transition-colors"
            >
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                  <Package size={16} className="text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">฿{parseFloat(p.price).toLocaleString()}</p>
              </div>
              {!p.is_active && (
                <Badge variant="outline" className="text-xs border-muted text-muted-foreground">
                  Inactive
                </Badge>
              )}
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                  <Pencil size={13} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id);
                  }}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {editing && (
        <ProductFormModal
          product={editing === "new" ? null : editing}
          token={token}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function OrdersTab({ token }: { token: string }) {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["admin-orders"],
    queryFn: () =>
      fetch("/api/admin/orders", { headers: authHeaders(token) }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm text-muted-foreground">{orders.length} orders</h2>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No orders yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Payment</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 font-mono text-muted-foreground">#{o.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-foreground font-medium">{o.telegram_first_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.telegram_username ? `@${o.telegram_username}` : ""} · {o.telegram_user_id}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-foreground">{o.product_name}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{o.payment_type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {o.created_at ? new Date(o.created_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (token: string) => void }) {
  const [step, setStep] = useState<"telegram-id" | "otp">("telegram-id");
  const [telegramId, setTelegramId] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestOtp = async () => {
    const id = parseInt(telegramId);
    if (!id) { setError("Enter a valid Telegram ID."); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: id }),
    });
    setLoading(false);
    if (!res.ok) { setError("Failed to send OTP. Check bot configuration."); return; }
    setStep("otp");
  };

  const verifyOtp = async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: parseInt(telegramId), otp_code: otp }),
    });
    setLoading(false);
    if (!res.ok) { setError("Invalid or expired OTP."); return; }
    const data = await res.json();
    localStorage.setItem("admin_token", data.access_token);
    onLogin(data.access_token);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-8"
      >
        <div className="flex items-center gap-2 mb-8">
          <Shield size={20} className="text-primary" />
          <span className="font-bold text-foreground">Admin Access</span>
        </div>

        {step === "telegram-id" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Your Telegram ID
              </label>
              <input
                type="number"
                placeholder="123456789"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && requestOtp()}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                An OTP will be sent to your admin group chat.
              </p>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button
              onClick={requestOtp}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-1"
            >
              {loading ? "Sending..." : <>Send OTP <ChevronRight size={14} /></>}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                OTP Code
              </label>
              <input
                type="text"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                maxLength={8}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-lg text-center font-mono tracking-widest text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                Check your admin group chat for the OTP.
              </p>
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <Button
              onClick={verifyOtp}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              {loading ? "Verifying..." : "Verify & Enter"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStep("telegram-id"); setError(""); }} className="text-muted-foreground">
              Back
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("admin_token"));

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    setToken(null);
  };

  if (!token) {
    return <LoginView onLogin={setToken} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-primary" />
            <span className="font-bold text-foreground text-sm">Store Admin</span>
          </div>
          <Button size="sm" variant="ghost" onClick={handleLogout} className="text-muted-foreground gap-1.5 text-xs">
            <LogOut size={13} /> Sign Out
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Tabs defaultValue="products">
          <TabsList className="bg-muted mb-6">
            <TabsTrigger value="products" className="gap-2">
              <Package size={14} /> Products
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <ClipboardList size={14} /> Orders
            </TabsTrigger>
          </TabsList>
          <TabsContent value="products">
            <ProductsTab token={token} />
          </TabsContent>
          <TabsContent value="orders">
            <OrdersTab token={token} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
