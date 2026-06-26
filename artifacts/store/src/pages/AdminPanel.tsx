import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Package, ClipboardList, LogOut, Shield, ChevronRight, Settings, Megaphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AnnouncementsTab from "@/components/AnnouncementsTab";

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
  telegram_user_id: number | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  phone_number: string | null;
  product_name: string;
  payment_type: string;
  payment_proof: string | null;
  status: string;
  link_sent: boolean;
  invite_links: string | null;
  created_at: string;
}

interface StoreSettings {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  store_name: string;
  bot_username: string;
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
          <DialogTitle>{isEdit ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {field("ชื่อสินค้า *", "name", "เช่น กลุ่มสัญญาณเทรด")}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">รายละเอียด</label>
            <textarea
              placeholder="อธิบายสิ่งที่ลูกค้าจะได้รับ..."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("ราคา (฿) *", "price", "500", "number")}
            {field("ราคาเดิม (฿)", "fake_discount_price", "799", "number")}
          </div>
          {field("URL รูปภาพ", "image_url", "https://...")}
          {field("Telegram Group IDs", "telegram_group_ids", "-100123456789,-100987654321")}
          <p className="text-xs text-muted-foreground -mt-1">
            คั่นด้วยคอมมาสำหรับหลายกลุ่ม บอตจะสร้างลิงก์เชิญใช้ครั้งเดียวให้แต่ละกลุ่ม
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
            <span className="text-sm text-foreground">{form.is_active ? "เปิดขาย" : "ปิดขาย"}</span>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name || !form.price}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold mt-1"
          >
            {mutation.isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
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
        <h2 className="text-sm text-muted-foreground">{products.length} สินค้า</h2>
        <Button size="sm" onClick={() => setEditing("new")} className="bg-primary text-primary-foreground gap-1">
          <Plus size={14} /> เพิ่มสินค้า
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
          <p className="text-sm">ยังไม่มีสินค้า กดเพิ่มสินค้าเพื่อเริ่มต้น</p>
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
                  ปิดขาย
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
                    if (confirm(`ลบ "${p.name}"?`)) deleteMutation.mutate(p.id);
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

function OrderProofViewer({ proof, type }: { proof: string | null; type: string }) {
  if (!proof) return <span className="text-muted-foreground text-xs">—</span>;
  if (type === "truemoney") {
    return (
      <a href={proof} target="_blank" rel="noopener noreferrer" className="text-primary text-xs flex items-center gap-1 hover:underline">
        ลิงก์ <ExternalLink size={10} />
      </a>
    );
  }
  if (proof.startsWith("data:image")) {
    return (
      <a href={proof} target="_blank" rel="noopener noreferrer" className="text-primary text-xs flex items-center gap-1 hover:underline">
        ดูสลีป <ExternalLink size={10} />
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground">{proof.slice(0, 30)}...</span>;
}

function SetLinksModal({ order, token, onClose }: { order: Order; token: string; onClose: () => void }) {
  const qc = useQueryClient();
  const existingLinks: string[] = (() => {
    try { return order.invite_links ? JSON.parse(order.invite_links) : []; } catch { return []; }
  })();
  const [lines, setLines] = useState(existingLinks.join("\n"));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const links = lines.split("\n").map((l) => l.trim()).filter(Boolean);
      if (links.length === 0) throw new Error("กรุณากรอกลิงก์อย่างน้อย 1 ลิงก์");
      const res = await fetch(`/api/admin/orders/${order.id}/links`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ invite_links: links }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "บันทึกไม่สำเร็จ"); }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      setSaved(true);
      setTimeout(() => onClose(), 1500);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">ใส่ลิงก์เชิญ — ออเดอร์ #{order.id}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{order.product_name} · {order.telegram_first_name || "—"}</p>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              ลิงก์ Telegram (1 ลิงก์ต่อบรรทัด)
            </label>
            <textarea
              rows={5}
              placeholder={"https://t.me/+xxxxxxxxxxxx\nhttps://t.me/+yyyyyyyyyyyy"}
              value={lines}
              onChange={(e) => { setLines(e.target.value); setError(""); setSaved(false); }}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none font-mono"
            />
            <p className="text-xs text-muted-foreground">จำนวน: {lines.split("\n").filter((l) => l.trim()).length} ลิงก์</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {saved && <p className="text-green-400 text-sm">✓ บันทึกสำเร็จ สถานะจะเปลี่ยนเป็น approved</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">ยกเลิก</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-bold">
              {mutation.isPending ? "กำลังบันทึก..." : "บันทึกลิงก์"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrdersTab({ token }: { token: string }) {
  const [setLinksOrder, setSetLinksOrder] = useState<Order | null>(null);

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["admin-orders"],
    queryFn: () =>
      fetch("/api/admin/orders", { headers: authHeaders(token) }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  return (
    <div>
      {setLinksOrder && (
        <SetLinksModal order={setLinksOrder} token={token} onClose={() => setSetLinksOrder(null)} />
      )}
      <div className="mb-4">
        <h2 className="text-sm text-muted-foreground">{orders.length} ออเดอร์</h2>
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
          <p className="text-sm">ยังไม่มีออเดอร์</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">ลูกค้า</th>
                <th className="px-4 py-3 text-left">สินค้า</th>
                <th className="px-4 py-3 text-left">หลักฐาน</th>
                <th className="px-4 py-3 text-left">สถานะ</th>
                <th className="px-4 py-3 text-left">วันที่</th>
                <th className="px-4 py-3 text-left">ลิงก์</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 font-mono text-muted-foreground">#{o.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-foreground font-medium">{o.telegram_first_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.telegram_username ? `@${o.telegram_username}` : ""}
                      {o.phone_number ? ` · ${o.phone_number}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-foreground">{o.product_name}</td>
                  <td className="px-4 py-3">
                    <OrderProofViewer proof={o.payment_proof ?? null} type={o.payment_type} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={o.status} />
                      {o.status === "approved" && (
                        <span className={`text-xs ${o.link_sent ? "text-green-400" : "text-yellow-400"}`}>
                          {o.link_sent ? "✓ ส่งลิงก์แล้ว" : "⚠ ยังไม่ได้ส่งลิงก์"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {o.created_at ? new Date(o.created_at).toLocaleDateString("th-TH") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSetLinksOrder(o)}
                      className="text-xs h-7 px-2 gap-1"
                    >
                      <ExternalLink size={11} />
                      {o.invite_links && (() => { try { return JSON.parse(o.invite_links).length > 0; } catch { return false; } })()
                        ? "แก้ลิงก์"
                        : "ใส่ลิงก์"}
                    </Button>
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

function SettingsTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => fetch("/api/store-settings").then((r) => r.json()),
  });

  const [form, setForm] = useState<StoreSettings>({
    store_name: "",
    hero_title: "",
    hero_subtitle: "",
    announcement: "",
    bot_username: "",
  });

  const [initialized, setInitialized] = useState(false);
  if (settings && !initialized) {
    setForm(settings);
    setInitialized(true);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/store-settings", {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["store-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading) {
    return <div className="h-40 animate-pulse bg-card border border-border rounded-lg" />;
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">ตั้งค่าหน้าร้าน</h2>
        <p className="text-sm text-muted-foreground">แก้ไขข้อความที่แสดงบนหน้าหลักของร้าน</p>
      </div>

      {/* Telegram Bot Settings */}
      <div className="flex flex-col gap-4 bg-card border border-[#229ED9]/30 rounded-xl p-5">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#229ED9]">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.29 13.91l-2.957-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.855.649z" />
          </svg>
          <h3 className="font-semibold text-foreground text-sm">ตั้งค่า Telegram Bot</h3>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bot Username</label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">@</span>
            <input
              type="text"
              value={form.bot_username.replace(/^@/, "")}
              onChange={(e) => setForm((f) => ({ ...f, bot_username: e.target.value.replace(/^@/, "") }))}
              placeholder="YourBotUsername"
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#229ED9]/60"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            ใส่ username บอท (ไม่ต้องมี @) — ใช้สร้างปุ่ม "รับสินค้าทาง Telegram" ให้ลูกค้ากดหลังสั่งซื้อ
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-card border border-border rounded-xl p-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ชื่อร้าน</label>
          <input
            type="text"
            value={form.store_name}
            onChange={(e) => setForm((f) => ({ ...f, store_name: e.target.value }))}
            placeholder="DigitalStore"
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">หัวข้อหลัก (Hero Title)</label>
          <input
            type="text"
            value={form.hero_title}
            onChange={(e) => setForm((f) => ({ ...f, hero_title: e.target.value }))}
            placeholder="สินค้าดิจิทัลพรีเมียม"
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">คำอธิบายใต้หัวข้อ (Hero Subtitle)</label>
          <input
            type="text"
            value={form.hero_subtitle}
            onChange={(e) => setForm((f) => ({ ...f, hero_subtitle: e.target.value }))}
            placeholder="รับสิทธิ์ทันทีผ่าน Telegram..."
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-card border border-yellow-500/30 rounded-xl p-5">
        <div className="flex items-center gap-2">
          <Megaphone size={15} className="text-yellow-400" />
          <h3 className="font-semibold text-foreground text-sm">ข้อความประกาศ</h3>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          แสดงแถบประกาศสีเหลืองด้านบนหน้าร้าน ปล่อยว่างเพื่อซ่อน
        </p>
        <textarea
          rows={5}
          value={form.announcement}
          onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))}
          placeholder={`⚠️ ประกาศสำคัญ\n\nห้ามปลอมแปลงสลีปโอนเงิน ขีดค่า ขีดชื่อ หรือแก้ไขคิวอาร์โค้ดใดๆ ทั้งสิ้น\nแอดมินไม่สามารถตรวจสอบสลีปที่ถูกแก้ไขได้ และจะถูกดำเนินคดีตามกฎหมาย`}
          className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-yellow-500/50 resize-none"
        />
      </div>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold self-start px-8"
      >
        {mutation.isPending ? "กำลังบันทึก..." : saved ? "✓ บันทึกแล้ว!" : "บันทึกการตั้งค่า"}
      </Button>
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
    if (!id) { setError("กรุณากรอก Telegram ID ที่ถูกต้อง"); return; }
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegram_id: id }),
    });
    setLoading(false);
    if (!res.ok) { setError("ส่ง OTP ไม่สำเร็จ ตรวจสอบการตั้งค่าบอต"); return; }
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
    if (!res.ok) { setError("OTP ไม่ถูกต้องหรือหมดอายุ"); return; }
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
          <span className="font-bold text-foreground">เข้าสู่ระบบแอดมิน</span>
        </div>

        {step === "telegram-id" ? (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Telegram ID ของคุณ
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
                OTP จะถูกส่งไปที่กลุ่มแอดมิน
              </p>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button
              onClick={requestOtp}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold gap-1"
            >
              {loading ? "กำลังส่ง..." : <>ส่ง OTP <ChevronRight size={14} /></>}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                รหัส OTP
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
                ตรวจสอบ OTP ในกลุ่มแอดมิน
              </p>
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <Button
              onClick={verifyOtp}
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              {loading ? "กำลังตรวจสอบ..." : "ยืนยัน & เข้าสู่ระบบ"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setStep("telegram-id"); setError(""); }} className="text-muted-foreground">
              ย้อนกลับ
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
            <LogOut size={13} /> ออกจากระบบ
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Tabs defaultValue="products">
          <TabsList className="bg-muted mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="products" className="gap-2">
              <Package size={14} /> สินค้า
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <ClipboardList size={14} /> ออเดอร์
            </TabsTrigger>
            <TabsTrigger value="announcements" className="gap-2">
              <Megaphone size={14} /> ประกาศ
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings size={14} /> ตั้งค่าร้าน
            </TabsTrigger>
          </TabsList>
          <TabsContent value="products">
            <ProductsTab token={token} />
          </TabsContent>
          <TabsContent value="orders">
            <OrdersTab token={token} />
          </TabsContent>
          <TabsContent value="announcements">
            <AnnouncementsTab token={token} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab token={token} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
