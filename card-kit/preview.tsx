// moira card kit - preview/share view, lifted near-verbatim from the intake
// zite app. scaffolding stripped (react-router); "(kit:" marks the seams.
// deps: react, framer-motion, lucide-react.
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  computeAllPositions, findNodeById, flattenTree, type MindmapNode,
} from '../data/mindmapData';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid, Film, Tv, Headphones, BookOpen, Gamepad2, Scissors,
  Music, Star, Heart, Camera, Coffee, Globe, Leaf, Zap, Flame,
  Sun, Moon, Cloud, Anchor, Mountain, Fish, Flower2, Cpu, Palette,
  PenTool, Mic, Radio, Package, Box, Disc, Tag, Users, FileText,
  Layers,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Film, Headphones, BookOpen, Gamepad2, Scissors, Music, Star, Heart,
  Camera, Coffee, Globe, Leaf, Zap, Flame, Sun, Moon, Cloud, Anchor,
  Mountain, Fish, Flower2, Cpu, Palette, PenTool, Mic, Radio, Tv,
  Package, Box, Disc, Tag, Users, LayoutGrid, FileText, Layers,
};

type Sub = { id: string; label: string; iconName: string; children?: Sub[] };
type Cat = { id: string; label: string; iconName: string; accent: string; subtypes: Sub[] };
type CardData = { front: Cat[]; back: Cat[] };

function loadCardData(): CardData {
  try {
    const card = localStorage.getItem('intake-card-v1');
    if (card) {
      const d = JSON.parse(card) as CardData;
      return { front: d.front ?? [], back: d.back ?? [] };
    }
    const s = localStorage.getItem('intake-cats-v3');
    const cats: Cat[] = s ? JSON.parse(s) : [];
    return { front: cats, back: [] };
  } catch { return { front: [], back: [] }; }
}

function loadName(): { name: string; handle: string } {
  try { return JSON.parse(localStorage.getItem('moira-profile') ?? ''); } catch { return { name: 'your name', handle: 'handle' }; }
}

/* ── Moira ID Card ──────────────────────────────────────────────────── */
function MoiraCard({ flipped, onFlip, onClick }: {
  flipped: boolean; onFlip: () => void; onClick: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ rx: 0, ry: 0 });
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 });
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ry = ((e.clientX - cx) / (rect.width / 2)) * 6;
    const rx = -((e.clientY - cy) / (rect.height / 2)) * 6;
    requestAnimationFrame(() => {
      setRotation({ rx, ry });
      setSpotlight({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      });
    });
  };

  const handleMouseLeave = () => {
    requestAnimationFrame(() => { setRotation({ rx: 0, ry: 0 }); setSpotlight({ x: 50, y: 50 }); });
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onFlip();
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onClick();
      }, 300);
    }
  };

  const flipY = flipped ? 180 : 0;
  const hasHover = rotation.rx !== 0 || rotation.ry !== 0;

  const face = (isBack = false) => (
    <div style={{
      position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
      transform: isBack ? 'rotateY(180deg)' : undefined, borderRadius: 18,
      background: 'linear-gradient(155deg, #1c1c1c 0%, #0d0d0d 60%, #111 100%)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
      padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between', overflow: 'hidden',
    }}>
      {/* Holographic spotlight */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none',
        background: `radial-gradient(circle at ${spotlight.x}% ${spotlight.y}%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)`,
        opacity: hasHover ? 1 : 0, transition: 'opacity 0.5s ease-out', mixBlendMode: 'overlay' as const,
      }} />
      {/* Grain */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none', opacity: 0.035,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />
      {/* Spacer — empty top area */}
      <div style={{ flex: 1 }} />
      {/* Bottom section — only on front */}
      {!isBack && (
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: 2,
              textTransform: 'uppercase', fontFamily: "'Space Mono', monospace",
              lineHeight: 1.1, marginBottom: 3,
            }}>
              {loadName().name}
            </div>
            <div style={{
              fontSize: 7, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.3,
              fontFamily: "'Space Mono', monospace",
            }}>
              @{loadName().handle} | moira by prixie
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 6.5, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5,
              textTransform: 'uppercase', fontWeight: 700, lineHeight: 1.5,
              fontFamily: "'Space Mono', monospace",
            }}>
              moira
            </div>
            <div style={{
              fontSize: 6.5, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.5,
              textTransform: 'uppercase', fontWeight: 700,
              fontFamily: "'Space Mono', monospace",
            }}>
              prixie labs
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ perspective: 1400 }}>
      <div
        ref={cardRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          width: 200,
          height: 127,
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.rx}deg) rotateY(${flipY + rotation.ry}deg)`,
          transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
          willChange: 'transform',
          cursor: 'pointer',
        }}
      >
        {face()}
        {face(true)}
      </div>
    </div>
  );
}

const toSlug = (s: string) =>
  s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '');

function subNode(sub: Sub, parentSlug: string): MindmapNode {
  const kids = sub.children ?? [];
  if (kids.length === 0) {
    return { id: sub.id, label: sub.label, Icon: ICON_MAP[sub.iconName] ?? LayoutGrid, path: `/preview/${parentSlug}/${toSlug(sub.label)}` };
  }
  return { id: sub.id, label: sub.label, Icon: ICON_MAP[sub.iconName] ?? LayoutGrid, children: kids.map(k => subNode(k, toSlug(sub.label))) };
}

function buildTree(cats: Cat[]): MindmapNode {
  return {
    id: 'root',
    label: 'my intake',
    Icon: LayoutGrid,
    children: cats.map(cat => ({
      id: cat.id,
      label: cat.label,
      Icon: (ICON_MAP[cat.iconName] ?? LayoutGrid),
      accent: cat.accent,
      children: cat.subtypes.map(sub => subNode(sub, toSlug(cat.label))),
    })),
  };
}

const NODE = 72, CENTER = 88;

export default function PreviewPage() {
  const [cardData] = useState(loadCardData);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [navPath, setNavPath] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });

  // Active side: front when not flipped, back when flipped
  const activeSide = cardFlipped ? 'back' : 'front';
  const activeCats = cardData[activeSide];

  // Build tree from only the active side's categories
  const tree = useMemo(() => buildTree(activeCats), [activeCats]);

  // When flipping, collapse everything
  const handleFlip = useCallback(() => {
    setCardFlipped(f => !f);
    setCollapsed(true);
    setNavPath([]);
  }, []);

  useEffect(() => {
    const update = () => ref.current && setDim({ w: ref.current.offsetWidth, h: ref.current.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const R = useMemo(() => Math.min(dim.w * 0.38, dim.h * 0.40, 440), [dim.w, dim.h]);
  const positions = useMemo(() => computeAllPositions(tree, R), [tree, R]);
  const allNodes = useMemo(() => flattenTree(tree), [tree]);

  const ancestorAccent = useMemo(() => {
    if (navPath.length === 0) return null;
    return tree.children?.find(c => c.id === navPath[0])?.accent ?? null;
  }, [navPath, tree]);

  const camera = useMemo(() => {
    if (collapsed) return { x: 0, y: 0 };
    const activeId = navPath.length > 0 ? navPath[navPath.length - 1] : 'root';
    const pos = positions.get(activeId) ?? { x: 0, y: 0 };
    return { x: -pos.x, y: -pos.y };
  }, [collapsed, navPath, positions]);

  const mountedIds = useMemo(() => {
    const ids = new Set<string>(['root']);
    if (collapsed) return ids;
    if (navPath.length === 0) {
      tree.children?.forEach(c => ids.add(c.id));
    } else {
      navPath.forEach(id => ids.add(id));
      const lastId = navPath[navPath.length - 1];
      findNodeById(tree, lastId)?.children?.forEach(c => ids.add(c.id));
    }
    return ids;
  }, [collapsed, navPath, tree]);

  const lines = useMemo(() => {
    if (collapsed) return [];
    if (navPath.length === 0) {
      return (tree.children ?? []).map(cat => {
        const p = positions.get(cat.id) ?? { x: 0, y: 0 };
        return { key: cat.id, x1: 0, y1: 0, x2: p.x, y2: p.y };
      });
    }
    const result: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < navPath.length - 1; i++) {
      const p1 = positions.get(navPath[i]) ?? { x: 0, y: 0 };
      const p2 = positions.get(navPath[i + 1]) ?? { x: 0, y: 0 };
      result.push({ key: `path-${i}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
    const lastId = navPath[navPath.length - 1];
    const lastNode = findNodeById(tree, lastId);
    const lastPos = positions.get(lastId) ?? { x: 0, y: 0 };
    (lastNode?.children ?? []).forEach(c => {
      const p = positions.get(c.id) ?? lastPos;
      result.push({ key: c.id, x1: lastPos.x, y1: lastPos.y, x2: p.x, y2: p.y });
    });
    return result;
  }, [collapsed, navPath, positions, tree]);

  function handleClick(node: MindmapNode) {
    if (node.id === 'root') {
      if (collapsed) setCollapsed(false);
      else if (navPath.length > 0) setNavPath([]);
      else setCollapsed(true);
      return;
    }
    const isFocused = navPath.length > 0 && navPath[navPath.length - 1] === node.id;
    if (isFocused) { setNavPath([]); return; }
    if (node.path) { navigate(node.path); return; }
    if (node.children) setNavPath(prev => [...prev, node.id]);
  }

  const totalCats = cardData.front.length + cardData.back.length;

  if (totalCats === 0) {
    return (
      <div className="moira-kit-page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 58px)', gap: 16, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40, opacity: 0.25 }}>◎</div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>nothing to preview yet</h2>
          <p style={{ margin: 0, color: 'var(--ec-muted)', fontSize: 14 }}>build your map first, then come back here.</p>
          <a href="#/app" style={{ background: 'var(--ink)', color: 'var(--bg)', padding: '9px 22px', borderRadius: 999, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
            open builder
          </a>
        </div>
      </div>
    );
  }

  const navSlot = (
    <a
      href="#/app"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: 'var(--p2)', color: 'var(--ink)',
        padding: '6px 14px', borderRadius: 999, textDecoration: 'none',
        fontWeight: 700, fontSize: 12, letterSpacing: 0.2,
        boxShadow: 'inset 0 0 0 1px var(--line)',
      }}
    >
      preview mode · edit ↗
    </a>
  );

  return (
    <div className="moira-kit-page">
      <div ref={ref} style={{ position: 'relative', overflow: 'hidden', height: 'calc(100vh - 58px)' }}>
        <motion.div
          style={{ position: 'absolute', left: '50%', top: '50%', transformOrigin: '0 0', willChange: 'transform' }}
          initial={{ x: 0, y: 0 }}
          animate={{ x: camera.x, y: camera.y }}
          transition={{ type: 'spring', stiffness: 100, damping: 20, mass: 1.2 }}
        >
          <svg style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
            <AnimatePresence>
              {lines.map(l => (
                <motion.line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke="color-mix(in oklab, var(--ink) 32%, transparent)" strokeWidth={2} strokeDasharray="6 4"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}
                />
              ))}
            </AnimatePresence>
          </svg>

          <AnimatePresence>
            {allNodes.filter(n => mountedIds.has(n.id)).map(node => {
              const pos = positions.get(node.id) ?? { x: 0, y: 0 };
              const isRoot = node.id === 'root';
              const isNavNode = navPath.includes(node.id);
              const size = isRoot ? CENTER : NODE;
              const half = size / 2;
              const hasAccent = !!node.accent;
              const isChild = !isRoot && !isNavNode && !!ancestorAccent;
              const bg = hasAccent
                ? `var(--${node.accent})`
                : isChild ? `color-mix(in oklab, var(--${ancestorAccent}) 45%, var(--ec-card) 55%)` : 'var(--ec-card)';

              if (isRoot) {
                const cardW = 200;
                const cardH = 127;
                return (
                  <motion.div key={node.id}
                    style={{ position: 'absolute', left: pos.x - cardW / 2, top: pos.y - cardH / 2, width: cardW, zIndex: 10 }}
                    initial={{ opacity: 0, scale: 0.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                  >
                    <MoiraCard
                      flipped={cardFlipped}
                      onFlip={handleFlip}
                      onClick={() => handleClick(node)}
                    />
                  </motion.div>
                );
              }

              return (
                <motion.div key={node.id}
                  style={{ position: 'absolute', left: pos.x - half, top: pos.y - half, width: size, cursor: 'pointer' }}
                  initial={{ opacity: 0, scale: 0.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                  onClick={() => handleClick(node)}
                >
                  <div className="select-none" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: size, height: size, borderRadius: 18, background: bg, boxShadow: 'var(--elev-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: (hasAccent || isChild) ? 'var(--icon-ink)' : 'var(--ink)' }}>
                      <node.Icon size={26} />
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.3, color: 'var(--ink)', maxWidth: size + 24, padding: '0 4px', whiteSpace: 'normal' }}>
                      {node.label}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>

        {/* Side indicator */}
        <div style={{
          position: 'absolute', top: 14, right: 16,
          fontSize: 10, fontWeight: 700, color: 'var(--ec-muted)',
          background: 'color-mix(in oklab, var(--bg) 82%, transparent)',
          padding: '5px 12px', borderRadius: 999, backdropFilter: 'blur(8px)',
          boxShadow: 'inset 0 0 0 1px var(--line)', letterSpacing: 1, textTransform: 'uppercase',
        }}>
          {activeSide} · {activeCats.length} categories
        </div>

        <AnimatePresence>
          {collapsed && (
            <motion.p key="hint"
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 0.5, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}
              style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', fontSize: 12, color: 'var(--ec-muted)', textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap' }}
            >
              click to explore · double-click card to flip
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {navPath.length > 0 && (
            <motion.div key="breadcrumb"
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              style={{ position: 'absolute', top: 14, left: 16, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, background: 'color-mix(in oklab, var(--bg) 82%, transparent)', padding: '5px 12px', borderRadius: 999, backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              <button onClick={() => setNavPath([])} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ec-muted)', fontSize: 12 }}>root</button>
              {navPath.map((id, i) => {
                const n = findNodeById(tree, id);
                const isLast = i === navPath.length - 1;
                return (
                  <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ opacity: 0.35, color: 'var(--ec-muted)' }}>›</span>
                    <button onClick={() => setNavPath(navPath.slice(0, i + 1))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: isLast ? 'var(--ink)' : 'var(--ec-muted)', fontWeight: isLast ? 700 : 400, fontSize: 12 }}>
                      {n?.label ?? id}
                    </button>
                  </span>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
