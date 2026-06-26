import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, ArrowLeft, ChevronLeft, ChevronRight, ImageOff, Calendar } from "lucide-react";
import { useLocation } from "wouter";

interface Announcement {
  id: number;
  title: string;
  content: string | null;
  images: string | null;
  font_size: string;
  is_active: boolean;
  created_at: string | null;
}

const FONT_SIZE_MAP: Record<string, string> = {
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

function ImageCarousel({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0);
  if (images.length === 0) return null;

  const prev = () => setCurrent((c) => (c - 1 + images.length) % images.length);
  const next = () => setCurrent((c) => (c + 1) % images.length);

  return (
    <div className="relative rounded-xl overflow-hidden bg-black/20">
      <AnimatePresence mode="wait">
        <motion.img
          key={current}
          src={images[current]}
          alt={`ภาพ ${current + 1}`}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.2 }}
          className="w-full max-h-80 object-contain rounded-xl"
        />
      </AnimatePresence>

      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          >
            <ChevronLeft size={16} className="text-white" />
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
          >
            <ChevronRight size={16} className="text-white" />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === current ? "bg-white w-4" : "bg-white/40"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AnnouncementCard({ ann, index }: { ann: Announcement; index: number }) {
  let images: string[] = [];
  try {
    if (ann.images) images = JSON.parse(ann.images);
  } catch {}

  const fontSize = FONT_SIZE_MAP[ann.font_size] ?? "text-base";
  const date = ann.created_at ? new Date(ann.created_at).toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric"
  }) : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.08 }}
      className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 transition-colors"
    >
      {images.length > 0 && (
        <div className="p-4 pb-0">
          <ImageCarousel images={images} />
        </div>
      )}

      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-bold text-foreground text-lg leading-tight">{ann.title}</h2>
          {date && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 mt-0.5">
              <Calendar size={11} />
              <span>{date}</span>
            </div>
          )}
        </div>

        {ann.content && (
          <p className={`text-foreground/80 whitespace-pre-wrap leading-relaxed ${fontSize}`}>
            {ann.content}
          </p>
        )}
      </div>
    </motion.article>
  );
}

export default function AnnouncementPage() {
  const [, setLocation] = useLocation();

  const { data: announcements = [], isLoading } = useQuery<Announcement[]>({
    queryKey: ["announcements"],
    queryFn: () => fetch("/api/announcements").then((r) => r.json()),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation("/")}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Megaphone size={18} className="text-primary" />
            <h1 className="font-bold text-foreground text-lg">ประกาศจากร้าน</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 bg-card border border-border rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <ImageOff size={28} className="text-muted-foreground/50" />
            </div>
            <p className="text-muted-foreground font-medium">ยังไม่มีประกาศในขณะนี้</p>
            <p className="text-muted-foreground/60 text-sm mt-1">กลับมาตรวจสอบใหม่ภายหลังนะครับ</p>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {announcements.map((ann, i) => (
              <AnnouncementCard key={ann.id} ann={ann} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
