import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, Megaphone, ImagePlus, X, ChevronLeft, ChevronRight, Eye, EyeOff, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Announcement {
  id: number;
  title: string;
  content: string | null;
  images: string | null;
  font_size: string;
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
}

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

const FONT_SIZES = [
  { value: "sm", label: "เล็ก (sm)" },
  { value: "base", label: "ปกติ (base)" },
  { value: "lg", label: "ใหญ่ (lg)" },
  { value: "xl", label: "ใหญ่มาก (xl)" },
  { value: "2xl", label: "ใหญ่พิเศษ (2xl)" },
];

const FONT_SIZE_PREVIEW: Record<string, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

function ImageCarouselPreview({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0);
  if (images.length === 0) return null;
  return (
    <div className="relative rounded-lg overflow-hidden bg-black/10 border border-border">
      <img
        src={images[current]}
        alt=""
        className="w-full h-40 object-contain rounded-lg"
      />
      {images.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? "bg-primary w-3" : "bg-muted-foreground/40"}`}
            />
          ))}
        </div>
      )}
      {images.length > 1 && (
        <>
          <button onClick={() => setCurrent((c) => (c - 1 + images.length) % images.length)}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
            <ChevronLeft size={12} className="text-white" />
          </button>
          <button onClick={() => setCurrent((c) => (c + 1) % images.length)}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
            <ChevronRight size={12} className="text-white" />
          </button>
        </>
      )}
    </div>
  );
}

function AnnouncementFormModal({
  announcement,
  token,
  onClose,
}: {
  announcement: Announcement | null;
  token: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = !!announcement;
  const fileInputRef = useRef<HTMLInputElement>(null);

  let initialImages: string[] = [];
  try {
    if (announcement?.images) initialImages = JSON.parse(announcement.images);
  } catch {}

  const [form, setForm] = useState({
    title: announcement?.title ?? "",
    content: announcement?.content ?? "",
    font_size: announcement?.font_size ?? "base",
    is_active: announcement?.is_active ?? true,
  });
  const [images, setImages] = useState<string[]>(initialImages);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title,
        content: form.content || null,
        images: images.length > 0 ? JSON.stringify(images) : null,
        font_size: form.font_size,
        is_active: form.is_active,
      };
      const url = isEdit ? `/api/admin/announcements/${announcement!.id}` : "/api/admin/announcements";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: authHeaders(token), body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
      onClose();
    },
    onError: () => setError("บันทึกไม่สำเร็จ กรุณาลองใหม่"),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const results: string[] = [];
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      results.push(base64);
    }
    setImages((prev) => [...prev, ...results]);
    setUploading(false);
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const previewFontClass = FONT_SIZE_PREVIEW[form.font_size] ?? "text-base";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone size={16} className="text-primary" />
            {isEdit ? "แก้ไขประกาศ" : "เพิ่มประกาศใหม่"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">ชื่อเรื่อง *</label>
            <input
              type="text"
              placeholder="เช่น ประกาศสำคัญ!"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">เนื้อหาประกาศ</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">ขนาดตัวอักษร:</span>
                <select
                  value={form.font_size}
                  onChange={(e) => setForm((f) => ({ ...f, font_size: e.target.value }))}
                  className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <textarea
              rows={6}
              placeholder="พิมพ์เนื้อหาประกาศที่นี่..."
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              className={`bg-muted border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none ${previewFontClass}`}
            />
            <p className="text-xs text-muted-foreground/60">ตัวอย่าง: ข้อความด้านบนแสดงขนาดจริงที่ลูกค้าเห็น</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">รูปภาพ ({images.length} ภาพ)</label>

            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden border border-border aspect-square">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={18} className="text-white" />
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black/60 rounded text-white text-xs px-1">{i + 1}</div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-border rounded-lg py-4 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              <ImagePlus size={20} />
              <span className="text-sm">{uploading ? "กำลังโหลด..." : "แตะเพื่อเพิ่มรูปภาพ"}</span>
              <span className="text-xs opacity-60">รองรับ JPG, PNG — เพิ่มได้หลายภาพ</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          <div className="flex items-center gap-3 py-2 px-3 bg-muted/50 rounded-lg">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${form.is_active ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.is_active ? "translate-x-5" : ""}`} />
            </button>
            <div>
              <p className="text-sm font-medium text-foreground">{form.is_active ? "แสดงประกาศ" : "ซ่อนประกาศ"}</p>
              <p className="text-xs text-muted-foreground">{form.is_active ? "ลูกค้าจะเห็นประกาศนี้" : "ลูกค้าจะไม่เห็นประกาศนี้"}</p>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1">ยกเลิก</Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.title.trim()}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              {mutation.isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "เพิ่มประกาศ"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AnnouncementsTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null | "new">(null);

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["admin-announcements"],
    queryFn: () =>
      fetch("/api/admin/announcements", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/announcements/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      fetch(`/api/admin/announcements/${id}`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ is_active }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, direction }: { id: number; direction: "up" | "down" }) =>
      fetch(`/api/admin/announcements/${id}/move?direction=${direction}`, { method: "POST", headers: authHeaders(token) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div>
          <h2 className="text-sm text-muted-foreground">{announcements.length} ประกาศ</h2>
        </div>
        <Button size="sm" onClick={() => setEditing("new")} className="bg-primary text-primary-foreground gap-1.5">
          <Plus size={14} /> เพิ่มประกาศ
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Megaphone size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">ยังไม่มีประกาศ</p>
          <p className="text-sm opacity-60 mt-1">กด "เพิ่มประกาศ" เพื่อสร้างประกาศแรก</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {announcements.map((ann, idx) => {
              let images: string[] = [];
              try { if (ann.images) images = JSON.parse(ann.images); } catch {}

              return (
                <motion.div
                  key={ann.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`bg-card border rounded-xl overflow-hidden transition-colors ${ann.is_active ? "border-border hover:border-primary/30" : "border-border/50 opacity-60"}`}
                >
                  <div className="flex gap-2 p-4">
                    <div className="flex flex-col gap-0.5 justify-center shrink-0">
                      <button
                        onClick={() => moveMutation.mutate({ id: ann.id, direction: "up" })}
                        disabled={idx === 0 || moveMutation.isPending}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => moveMutation.mutate({ id: ann.id, direction: "down" })}
                        disabled={idx === announcements.length - 1 || moveMutation.isPending}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ArrowDown size={13} />
                      </button>
                    </div>
                    {images.length > 0 && (
                      <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
                        <img src={images[0]} alt="" className="w-full h-full object-cover" />
                        {images.length > 1 && (
                          <div className="absolute bottom-0 right-0 bg-black/70 text-white text-xs px-1 rounded-tl">+{images.length - 1}</div>
                        )}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-foreground text-sm leading-tight truncate">{ann.title}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => toggleMutation.mutate({ id: ann.id, is_active: !ann.is_active })}
                            title={ann.is_active ? "ซ่อนประกาศ" : "แสดงประกาศ"}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          >
                            {ann.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                          <button
                            onClick={() => setEditing(ann)}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`ลบ "${ann.title}"?`)) deleteMutation.mutate(ann.id); }}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${ann.is_active ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                          {ann.is_active ? "กำลังแสดง" : "ซ่อนอยู่"}
                        </span>
                        <span className="text-xs text-muted-foreground/60">ขนาด: {ann.font_size}</span>
                        {images.length > 0 && (
                          <span className="text-xs text-muted-foreground/60">{images.length} รูป</span>
                        )}
                      </div>

                      {ann.content && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                          {ann.content}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {editing && (
        <AnnouncementFormModal
          announcement={editing === "new" ? null : editing}
          token={token}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
