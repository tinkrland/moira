// moira card kit - lifted from the intake zite app's "make your own" builder,
// near-verbatim. only the site scaffolding was stripped (react-router,
// sonner, the app layout): look for "(kit:" markers for the seams.
// deps: react, framer-motion, lucide-react.
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, ChevronDown, X, Copy, Check, Download, KeyRound, ArrowRight, RotateCw,
  Film, Headphones, BookOpen, Gamepad2, Scissors, Music, Star, Heart,
  Camera, Coffee, Globe, Leaf, Zap, Flame, Sun, Moon, Cloud, Anchor,
  Mountain, Fish, Flower2, Cpu, Palette, PenTool, Mic, Radio, Tv,
  Package, Box, Disc, Tag, Users, LayoutGrid, FileText, Layers, Pencil,
} from 'lucide-react';


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, any> = {
  Film, Headphones, BookOpen, Gamepad2, Scissors, Music, Star, Heart,
  Camera, Coffee, Globe, Leaf, Zap, Flame, Sun, Moon, Cloud, Anchor,
  Mountain, Fish, Flower2, Cpu, Palette, PenTool, Mic, Radio, Tv,
  Package, Box, Disc, Tag, Users, LayoutGrid, FileText, Layers, RotateCw,
};
const ICON_KEYS = Object.keys(ICON_MAP);
const ACCENTS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;
type Accent = typeof ACCENTS[number];

type Sub = { id: string; label: string; iconName: string; children?: Sub[] };
type Cat = { id: string; label: string; iconName: string; accent: Accent; subtypes: Sub[] };
type CtxMenu = { catId: string; subId?: string; x: number; y: number };
type TSub = { label: string; iconName: string; children?: TSub[] };
type Tmpl = { label: string; iconName: string; accent: Accent; subs: TSub[] };
type Side = 'front' | 'back';
type CardData = { front: Cat[]; back: Cat[] };

const L = (label: string, iconName: string, children?: TSub[]): TSub => ({ label, iconName, children });
const TEMPLATES: Tmpl[] = [
  { label: 'knowledge', iconName: 'BookOpen', accent: 'p4', subs: [
    L('projects', 'Layers'), L('files', 'FileText'), L('notes', 'PenTool'), L('research', 'Globe'), L('courses', 'BookOpen'),
  ]},
  { label: 'media', iconName: 'Film', accent: 'p1', subs: [
    L('visual', 'Film', [L('films', 'Film'), L('tv shows', 'Tv'), L('documentaries', 'Camera'), L('creators', 'Users'), L('true crime', 'Layers'), L('animated', 'Palette')]),
    L('audio', 'Headphones', [L('artists', 'Music'), L('albums', 'Disc'), L('playlists', 'Tag'), L('songs', 'Music'), L('podcasts', 'Mic'), L('audiobooks', 'BookOpen')]),
    L('written', 'BookOpen', [L('fiction', 'BookOpen'), L('non-fiction', 'FileText'), L('comics / manga', 'Layers'), L('articles', 'FileText'), L('poetry', 'PenTool')]),
    L('games / ar', 'Gamepad2', [L('video games', 'Gamepad2'), L('board games', 'Package'), L('vr / ar', 'Globe'), L('mobile', 'Cpu'), L('tabletop rpgs', 'Flame')]),
    L('physical', 'Scissors', [L('knitting / sewing', 'Scissors'), L('origami', 'Flower2'), L('woodworking', 'Mountain'), L('pottery', 'Coffee'), L('model kits', 'Box')]),
    L('trinkets', 'Tag', [L('pins & badges', 'Star'), L('stickers', 'Leaf'), L('keychains', 'Heart'), L('patches', 'Flower2'), L('figurines', 'Box'), L('charms', 'Package')]),
  ]},
  { label: 'taste', iconName: 'Heart', accent: 'p1', subs: [
    L('food', 'Coffee'), L('aesthetics', 'Palette'), L('scents', 'Flower2'), L('places', 'Globe'),
  ]},
  { label: 'lifestyle', iconName: 'Sun', accent: 'p2', subs: [
    L('fashion', 'Scissors'), L('health', 'Heart'), L('fitness', 'Zap'), L('home', 'Box'), L('travel', 'Globe'),
  ]},
  { label: 'people', iconName: 'Users', accent: 'p3', subs: [
    L('professional', 'Users'), L('personal', 'Heart'), L('family', 'Users'), L('friends', 'Star'), L('other', 'Users'),
  ]},
  { label: 'ongoing', iconName: 'RotateCw', accent: 'p5', subs: [
    L('calendar', 'Moon'), L('schedule', 'Sun'), L('project plans', 'Layers'),
  ]},
  { label: 'techstack', iconName: 'Cpu', accent: 'p4', subs: [
    L('ai agent', 'Zap'), L('design', 'Palette'), L('dev', 'Cpu'), L('productivity', 'Layers'),
  ]},
  { label: 'utility', iconName: 'Package', accent: 'p5', subs: [
    L('tools', 'Box'), L('accounts', 'Tag'), L('devices', 'Cpu'),
  ]},
];

const DEFAULT_FRONT: Cat[] = [
  { id: 'cat-d1', label: 'media', iconName: 'Film', accent: 'p1',
    subtypes: [
      { id: 's-d1', label: 'audio', iconName: 'Headphones', children: [
        { id: 'ss-d1', label: 'artists', iconName: 'Music' },
        { id: 'ss-d2', label: 'albums', iconName: 'Disc' },
      ]},
    ]},
];
function loadCardData(): CardData {
  try {
    const s = localStorage.getItem('intake-card-v1');
    if (s) return JSON.parse(s);
    const old = localStorage.getItem('intake-cats-v3');
    const front = old ? JSON.parse(old) : DEFAULT_FRONT;
    return { front, back: [] };
  } catch { return { front: DEFAULT_FRONT, back: [] }; }
}
function saveCardData(data: CardData) {
  localStorage.setItem('intake-card-v1', JSON.stringify(data));
  localStorage.setItem('intake-cats-v3', JSON.stringify([...data.front, ...data.back]));
}
function toSub(t: TSub): Sub {
  return { id: uid(), label: t.label, iconName: t.iconName, children: t.children?.map(toSub) };
}
function loadProfile(): { name: string; handle: string } {
  try { return JSON.parse(localStorage.getItem('moira-profile') ?? '') ; } catch { return { name: 'your name', handle: 'handle' }; }
}
// Accent strength per depth: 100% → 55% → 30% → … (each level ~45% lighter)
function depthMix(depth: number) { return Math.round(100 * Math.pow(0.55, depth)); }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }

// ── Template Picker modal ─────────────────────────────────────────────────────
function TemplatePicker({ onPick }: { onPick: (t: Tmpl | null) => void }) {
  return (
    <motion.div key="tmpl-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={() => onPick(null)}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'color-mix(in oklab, var(--bg) 82%, transparent)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <motion.div initial={{ scale: 0.92, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 30 }} onClick={e => e.stopPropagation()}
        style={{ background: 'var(--ec-card)', border: '1px solid var(--line)', borderRadius: 22, padding: 26, width: 'min(600px, 100%)', boxShadow: 'var(--elev-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <h3 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 700 }}>pick a template</h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ec-muted)' }}>you can add or edit subtypes after</p>
          </div>
          <button onClick={() => onPick(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ec-muted)', padding: 2 }}><X size={15} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: 10 }}>
          {TEMPLATES.map(t => {
            const Icon = ICON_MAP[t.iconName] ?? LayoutGrid;
            return (
              <button key={t.label} onClick={() => onPick(t)}
                style={{ background: `color-mix(in oklab, var(--${t.accent}) 20%, var(--bg) 80%)`, border: `1.5px solid color-mix(in oklab, var(--${t.accent}) 50%, var(--line) 50%)`, borderRadius: 14, padding: '14px 12px', cursor: 'pointer', textAlign: 'left', transition: 'transform 0.12s ease, box-shadow 0.12s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: `var(--${t.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }}><Icon size={18} /></div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 5 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: 'var(--ec-muted)', lineHeight: 1.65 }}>
                  {t.subs.slice(0, 3).map(x => x.label).join(' · ')}{t.subs.length > 3 ? ` +${t.subs.length - 3}` : ''}
                </div>
              </button>
            );
          })}
          <button onClick={() => onPick(null)}
            style={{ background: 'transparent', border: '1.5px dashed var(--line)', borderRadius: 14, padding: '14px 12px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, border: '1.5px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }}><Plus size={17} style={{ color: 'var(--ec-muted)' }} /></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>blank</div>
            <div style={{ fontSize: 10, color: 'var(--ec-muted)' }}>start fresh</div>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Key step ──────────────────────────────────────────────────────────────────
function KeyStep({ editorKey, onBack, onContinue }: { editorKey: string; onBack: () => void; onContinue: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(editorKey).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const saveAsTxt = () => {
    const content = ['moira editor key', '', editorKey, '', 'Keep this somewhere safe.', 'This is the only credential that lets you edit your moira shrine later.', `Generated: ${new Date().toLocaleString()}`].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'intake-editor-key.txt'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const btn = (onClick: () => void, children: React.ReactNode, disabled = false, primary = false) => (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: primary ? 'var(--ink)' : 'var(--ec-card)', color: primary ? 'var(--bg)' : 'var(--ink)',
      border: primary ? 'none' : '1px solid var(--line)', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1, boxShadow: primary ? 'var(--elev-1)' : 'none',
    }}>{children}</button>
  );
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 58px)', padding: 24 }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--p2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><KeyRound size={22} /></div>
          <div><h2 style={{ margin: '0 0 3px', fontSize: 20, fontWeight: 700 }}>your editor key</h2><p style={{ margin: 0, fontSize: 13, color: 'var(--ec-muted)' }}>save this before continuing</p></div>
        </div>
        <p style={{ color: 'var(--ec-muted)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.7 }}>this SHA-256 key is the only credential that lets you edit your shrine after leaving.</p>
        <div style={{ background: 'var(--ec-card)', borderRadius: 12, padding: '14px 18px', fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all', letterSpacing: 0.4, lineHeight: 1.8, boxShadow: 'inset 0 0 0 1.5px var(--line)', marginBottom: 16, color: 'var(--ink)', userSelect: 'all' }}>{editorKey}</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          {btn(copy, <>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'copied!' : 'copy key'}</>)}
          {btn(saveAsTxt, <><Download size={14} /> save as .txt</>)}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 28, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--ink)' }} />
          i've saved my editor key somewhere safe
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {btn(onBack, 'back to builder')}
          {btn(onContinue, <>open your preview <ArrowRight size={14} /></>, !confirmed, true)}
        </div>
      </div>
    </motion.div>
  );
}

// ── Right-click icon ctx menu ─────────────────────────────────────────────────
function IconCtxMenu({ menu, onPick, onClose }: { menu: CtxMenu; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const w = 226; const x = Math.min(menu.x, window.innerWidth - w - 8); const y = Math.min(menu.y, window.innerHeight - 260);
  return (
    <div ref={ref} style={{ position: 'fixed', left: x, top: y, zIndex: 300, background: 'var(--ec-card)', border: '1px solid var(--line)', borderRadius: 14, padding: 10, boxShadow: 'var(--elev-2)', width: w }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ec-muted)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--line)', letterSpacing: 0.5 }}>change icon</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5 }}>
        {ICON_KEYS.map(k => { const I = ICON_MAP[k]!; return (
          <button key={k} onClick={() => { onPick(k); onClose(); }} title={k}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.1s' }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--ec-card)')}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'var(--bg)')}
          ><I size={14} /></button>
        ); })}
      </div>
    </div>
  );
}

// ── Moira ID Card (center node) ────────────────────────────────────────────
function MoiraCardBuilder({ flipped, onFlip, onClick, onContextMenu, name, handle, width = 280 }: {
  flipped: boolean; onFlip: () => void; onClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
  name: string; handle: string; width?: number;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ rx: 0, ry: 0 });
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 });
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const ry = ((e.clientX - cx) / (rect.width / 2)) * 6;
    const rx = -((e.clientY - cy) / (rect.height / 2)) * 6;
    requestAnimationFrame(() => {
      setRotation({ rx, ry });
      setSpotlight({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
    });
  };
  const handleMouseLeave = () => requestAnimationFrame(() => { setRotation({ rx: 0, ry: 0 }); setSpotlight({ x: 50, y: 50 }); });
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; onFlip(); }
    else { clickTimer.current = setTimeout(() => { clickTimer.current = null; onClick(); }, 300); }
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
      padding: '18px 22px', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none',
        background: `radial-gradient(circle at ${spotlight.x}% ${spotlight.y}%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)`,
        opacity: hasHover ? 1 : 0, transition: 'opacity 0.5s ease-out', mixBlendMode: 'overlay' as const,
      }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none', opacity: 0.035,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />
      <div style={{ flex: 1 }} />
      {!isBack && (
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 2, textTransform: 'uppercase' as const, fontFamily: "'Space Mono', monospace", lineHeight: 1.1, marginBottom: 3 }}>{name}</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.3, fontFamily: "'Space Mono', monospace" }}>@{handle} | moira by prixie</div>
          </div>
          <div style={{ textAlign: 'right' as const }}>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, textTransform: 'uppercase' as const, fontWeight: 700, lineHeight: 1.5, fontFamily: "'Space Mono', monospace" }}>moira</div>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.5, textTransform: 'uppercase' as const, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>prixie labs</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ perspective: 1400, width }}>
      <div ref={cardRef} onClick={handleClick} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e); }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
        style={{
          width, aspectRatio: '1.58 / 1', position: 'relative', transformStyle: 'preserve-3d',
          transform: `rotateX(${rotation.rx}deg) rotateY(${flipY + rotation.ry}deg)`,
          transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)', willChange: 'transform', cursor: 'pointer',
        }}>
        {face()}
        {face(true)}
      </div>
    </div>
  );
}

// ── Mindmap preview (right panel) ─────────────────────────────────────────────
const MINDMAP_NODE = 60;

function MindmapPreview({ cardData, flipped, onFlip, activeSide }: {
  cardData: CardData; flipped: boolean; onFlip: () => void; activeSide: Side;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [mapExpanded, setMapExpanded] = useState(false);
  const [focusedCat, setFocusedCat] = useState<string | null>(null);
  const [focusedSub, setFocusedSub] = useState<string | null>(null);
  const [profile, setProfile] = useState(loadProfile);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const prevSideRef = useRef(activeSide);

  // Collapse when side changes (flip)
  useEffect(() => {
    if (prevSideRef.current !== activeSide) {
      setMapExpanded(false);
      setFocusedCat(null);
      setFocusedSub(null);
      prevSideRef.current = activeSide;
    }
  }, [activeSide]);

  useEffect(() => {
    const update = () => panelRef.current && setDim({ w: panelRef.current.offsetWidth, h: panelRef.current.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, []);

  const activeCats = useMemo(() => cardData[activeSide], [cardData, activeSide]);
  const R = useMemo(() => Math.min(dim.w * 0.35, dim.h * 0.35, 280), [dim.w, dim.h]);

  const catPositions = useMemo(() => {
    const n = activeCats.length;
    if (n === 0) return [];
    return activeCats.map((cat, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      return { cat, x: R * Math.cos(angle), y: R * Math.sin(angle) };
    });
  }, [activeCats, R]);

  const subPositions = useMemo(() => {
    if (!focusedCat) return [];
    const cat = activeCats.find(c => c.id === focusedCat);
    if (!cat || cat.subtypes.length === 0) return [];
    const parent = catPositions.find(cp => cp.cat.id === focusedCat);
    if (!parent) return [];
    const n = cat.subtypes.length;
    const subR = Math.max(R * 0.6, ((n + 1) * 78) / (2 * Math.PI));
    const back = Math.atan2(-parent.y, -parent.x);
    return cat.subtypes.map((sub, i) => {
      const angle = back + (2 * Math.PI * (i + 1)) / (n + 1);
      return { sub, catId: cat.id, accent: cat.accent, px: parent.x, py: parent.y, x: parent.x + subR * Math.cos(angle), y: parent.y + subR * Math.sin(angle) };
    });
  }, [focusedCat, activeCats, catPositions, R]);

  const subSubPositions = useMemo(() => {
    if (!focusedSub) return [];
    const sp = subPositions.find(p => p.sub.id === focusedSub);
    const kids = sp?.sub.children ?? [];
    if (!sp || kids.length === 0) return [];
    const r = Math.max(R * 0.45, ((kids.length + 1) * 74) / (2 * Math.PI));
    const back = Math.atan2(sp.py - sp.y, sp.px - sp.x);
    return kids.map((k, i) => {
      const a = back + (2 * Math.PI * (i + 1)) / (kids.length + 1);
      return { sub: k, accent: sp.accent, px: sp.x, py: sp.y, x: sp.x + r * Math.cos(a), y: sp.y + r * Math.sin(a) };
    });
  }, [focusedSub, subPositions, R]);

  const handleCardClick = () => {
    if (mapExpanded) { setMapExpanded(false); setFocusedCat(null); setFocusedSub(null); }
    else { setMapExpanded(true); }
  };
  const handleCatClick = (catId: string) => { setFocusedSub(null); setFocusedCat(prev => prev === catId ? null : catId); };
  const handleSubClick = (sub: Sub) => { if (sub.children?.length) setFocusedSub(prev => prev === sub.id ? null : sub.id); };

  const camera = useMemo(() => {
    if (focusedSub) {
      const sp = subPositions.find(p => p.sub.id === focusedSub);
      if (sp) return { x: -sp.x, y: -sp.y };
    }
    if (focusedCat) {
      const cp = catPositions.find(c => c.cat.id === focusedCat);
      if (cp) return { x: -cp.x, y: -cp.y };
    }
    return { x: 0, y: 0 };
  }, [focusedCat, focusedSub, catPositions, subPositions]);

  const cardW = 280;
  const cardH = cardW / 1.58;

  return (
    <div ref={panelRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <motion.div
        style={{ position: 'absolute', left: '50%', top: '50%', transformOrigin: '0 0' }}
        animate={{ x: camera.x, y: camera.y }}
        transition={{ type: 'spring', stiffness: 120, damping: 22, mass: 1 }}
      >
        {/* Connection lines */}
        <svg style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
          <AnimatePresence>
            {mapExpanded && catPositions.filter(cp => !focusedCat || cp.cat.id === focusedCat).map(cp => (
              <motion.line key={`l-${cp.cat.id}`}
                x1={0} y1={0} x2={cp.x} y2={cp.y}
                stroke="color-mix(in oklab, var(--ink) 22%, transparent)" strokeWidth={1.5} strokeDasharray="6 4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
              />
            ))}
            {subPositions.filter(sp => !focusedSub || sp.sub.id === focusedSub).map(sp => (
              <motion.line key={`sl-${sp.sub.id}`}
                x1={sp.px} y1={sp.py} x2={sp.x} y2={sp.y}
                stroke="color-mix(in oklab, var(--ink) 14%, transparent)" strokeWidth={1} strokeDasharray="4 3"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              />
            ))}
            {subSubPositions.map(sp => (
              <motion.line key={`ssl-${sp.sub.id}`}
                x1={sp.px} y1={sp.py} x2={sp.x} y2={sp.y}
                stroke="color-mix(in oklab, var(--ink) 14%, transparent)" strokeWidth={1} strokeDasharray="3 3"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              />
            ))}
          </AnimatePresence>
        </svg>

        {/* Category nodes */}
        <AnimatePresence>
          {mapExpanded && catPositions.filter(cp => !focusedCat || cp.cat.id === focusedCat).map(cp => {
            const CatIcon = ICON_MAP[cp.cat.iconName] ?? LayoutGrid;
            const half = MINDMAP_NODE / 2;
            const isFocused = focusedCat === cp.cat.id;
            return (
              <motion.div key={cp.cat.id}
                style={{ position: 'absolute', left: cp.x - half, top: cp.y - half, width: MINDMAP_NODE, cursor: 'pointer', zIndex: isFocused ? 5 : 1 }}
                initial={{ opacity: 0, scale: 0.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.1 }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                onClick={e => { e.stopPropagation(); handleCatClick(cp.cat.id); }}
              >
                <div className="select-none" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: MINDMAP_NODE, height: MINDMAP_NODE, borderRadius: 16,
                    background: `var(--${cp.cat.accent})`,
                    boxShadow: isFocused ? `0 0 0 3px var(--${cp.cat.accent}), var(--elev-2)` : 'var(--elev-1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--icon-ink)',
                    transition: 'box-shadow 0.2s ease',
                  }}>
                    <CatIcon size={24} />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', lineHeight: 1.2, color: 'var(--ink)', maxWidth: MINDMAP_NODE + 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cp.cat.label}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Subtype nodes */}
        <AnimatePresence>
          {subPositions.filter(sp => !focusedSub || sp.sub.id === focusedSub).map(sp => {
            const SubIcon = ICON_MAP[sp.sub.iconName] ?? Star;
            const sz = 44; const half = sz / 2;
            return (
              <motion.div key={sp.sub.id}
                style={{ position: 'absolute', left: sp.x - half, top: sp.y - half, width: sz, cursor: sp.sub.children?.length ? 'pointer' : 'default', zIndex: focusedSub === sp.sub.id ? 5 : 1 }}
                onClick={e => { e.stopPropagation(); handleSubClick(sp.sub); }}
                initial={{ opacity: 0, scale: 0.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.1 }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              >
                <div className="select-none" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: sz, height: sz, borderRadius: 12,
                    background: `color-mix(in oklab, var(--${sp.accent}) ${depthMix(1)}%, var(--ec-card))`,
                    boxShadow: focusedSub === sp.sub.id ? `0 0 0 2px var(--${sp.accent}), var(--elev-2)` : 'var(--elev-1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', position: 'relative',
                  }}>
                    <SubIcon size={18} />
                  </div>
                  <span style={{ fontSize: 8.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2, color: 'var(--ink)', maxWidth: sz + 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sp.sub.label}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Sub-subtype nodes */}
        <AnimatePresence>
          {subSubPositions.map(sp => {
            const I = ICON_MAP[sp.sub.iconName] ?? Star;
            const sz = 34;
            return (
              <motion.div key={sp.sub.id}
                style={{ position: 'absolute', left: sp.x - sz / 2, top: sp.y - sz / 2, width: sz }}
                initial={{ opacity: 0, scale: 0.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.1 }}
                transition={{ type: 'spring', stiffness: 340, damping: 26 }}>
                <div className="select-none" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{ width: sz, height: sz, borderRadius: 10, background: `color-mix(in oklab, var(--${sp.accent}) ${depthMix(2)}%, var(--ec-card))`, boxShadow: 'var(--elev-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)' }}>
                    <I size={14} />
                  </div>
                  <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{sp.sub.label}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* ID Card at center */}
        <div style={{ position: 'absolute', left: -cardW / 2, top: -cardH / 2, zIndex: 10 }}>
          <MoiraCardBuilder flipped={flipped} onFlip={onFlip} onClick={handleCardClick} width={cardW}
            name={profile.name} handle={profile.handle}
            onContextMenu={e => setCardMenu({ x: e.clientX, y: e.clientY })} />
        </div>
      </motion.div>

      <AnimatePresence>
        {!mapExpanded && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} exit={{ opacity: 0 }}
            style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--ec-muted)', textAlign: 'center', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            click card to expand · right-click for options
          </motion.p>
        )}
      </AnimatePresence>

      {cardMenu && (
        <CardMenu x={cardMenu.x} y={cardMenu.y} onClose={() => setCardMenu(null)}
          onEditName={() => { setCardMenu(null); setEditingName(true); }}
          onDesign={() => { setCardMenu(null); void 0; // (kit: host feedback hook) }} />
      )}
      <EditNameDialog open={editingName} profile={profile} onClose={() => setEditingName(false)}
        onSave={p => { setProfile(p); localStorage.setItem('moira-profile', JSON.stringify(p)); setEditingName(false); }} />
    </div>
  );
}

function CardMenu({ x, y, onClose, onEditName, onDesign }: { x: number; y: number; onClose: () => void; onEditName: () => void; onDesign: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);
  const item = (label: string, Icon: typeof Pencil, onClick: () => void, hint?: string) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
      <Icon size={13} /> <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontSize: 9, color: 'var(--ec-muted)' }}>{hint}</span>}
    </button>
  );
  return (
    <div ref={ref} style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 190), top: Math.min(y, window.innerHeight - 100), zIndex: 300, width: 180, background: 'var(--ec-card)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, boxShadow: 'var(--elev-2)' }}>
      {item('edit name', Pencil, onEditName)}
      {item('design card', Palette, onDesign, 'soon')}
    </div>
  );
}

function EditNameDialog({ open, profile, onClose, onSave }: { open: boolean; profile: { name: string; handle: string }; onClose: () => void; onSave: (p: { name: string; handle: string }) => void }) {
  const [name, setName] = useState(profile.name);
  const [handle, setHandle] = useState(profile.handle);
  useEffect(() => { if (open) { setName(profile.name); setHandle(profile.handle); } }, [open, profile]);
  const valid = name.trim().length > 0 && name.length <= 24 && /^[a-z0-9_.]{1,20}$/i.test(handle);
  if (!open) return null;
  const input = { width: '100%', border: '1px solid var(--line)', background: 'var(--bg)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--ink)', fontFamily: "'Space Mono', monospace", outline: 'none', marginTop: 4 } as const;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 310, background: 'color-mix(in oklab, var(--bg) 70%, transparent)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (valid) onSave({ name: name.trim(), handle }); }}
        style={{ width: 'min(360px, 100%)', background: 'var(--ec-card)', border: '1px solid var(--line)', borderRadius: 16, padding: 20, boxShadow: 'var(--elev-2)' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>edit name</h3>
        <label style={{ fontSize: 11, color: 'var(--ec-muted)' }}>name<input autoFocus value={name} maxLength={24} onChange={e => setName(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: 'var(--ec-muted)', display: 'block', marginTop: 10 }}>handle<input value={handle} onChange={e => setHandle(e.target.value.replace(/^@/, ''))} style={input} /></label>
        {!/^[a-z0-9_.]{1,20}$/i.test(handle) && <p style={{ margin: '6px 0 0', fontSize: 10, color: 'hsl(var(--destructive))' }}>letters, numbers, _ and . only (max 20)</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--ink)' }}>cancel</button>
          <button type="submit" disabled={!valid} style={{ background: 'var(--ink)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.4 }}>save</button>
        </div>
      </form>
    </div>
  );
}

// ── Main Builder Page ─────────────────────────────────────────────────────────
export default function BuilderPage() {
  const navigate = (to: string) => { window.location.hash = to; }; // (kit: host router hook)
  const [step, setStep] = useState<'build' | 'key'>('build');
  const [editorKey, setEditorKey] = useState<string>(() => localStorage.getItem('intake-editor-key') ?? '');
  const [cardData, setCardData] = useState<CardData>(loadCardData);
  const [side, setSide] = useState<Side>('front');
  const [flipped, setFlipped] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cats = cardData[side];

  const enterKeyStep = async () => {
    let key = editorKey;
    if (!key) {
      const uuid = crypto.randomUUID();
      const buffer = new TextEncoder().encode(uuid);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      key = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('intake-editor-key', key);
      setEditorKey(key);
    }
    setStep('key');
  };

  const commit = useCallback((nextCats: Cat[]) => {
    setCardData(prev => {
      const next = { ...prev, [side]: nextCats };
      saveCardData(next);
      return next;
    });
  }, [side]);

  const handleFlip = useCallback(() => {
    setFlipped(f => !f);
    setTimeout(() => setSide(s => s === 'front' ? 'back' : 'front'), 350);
  }, []);

  const pickTemplate = useCallback((t: Tmpl | null) => {
    setShowPicker(false);
    const id = uid();
    if (t) {
      commit([...cats, { id, label: t.label, iconName: t.iconName, accent: t.accent, subtypes: t.subs.map(toSub) }]);
    } else {
      commit([...cats, { id, label: 'new category', iconName: 'Star', accent: 'p3', subtypes: [] }]);
    }
    setExpanded(prev => new Set([...prev, id]));
  }, [cats, commit]);

  const delCat = (id: string) => commit(cats.filter(c => c.id !== id));
  const updateCat = (id: string, p: Partial<Cat>) => commit(cats.map(c => c.id === id ? { ...c, ...p } : c));
  const addSub = (cid: string) => commit(cats.map(c => c.id === cid ? { ...c, subtypes: [...c.subtypes, { id: uid(), label: 'new subtype', iconName: 'Star' }] } : c));
  const delSub = (cid: string, sid: string) => commit(cats.map(c => c.id === cid ? { ...c, subtypes: c.subtypes.filter(s => s.id !== sid) } : c));
  const updateSub = (cid: string, sid: string, p: Partial<Sub>) => commit(cats.map(c => c.id === cid ? { ...c, subtypes: c.subtypes.map(s => s.id === sid ? { ...s, ...p } : s) } : c));
  const mapSub = (cid: string, sid: string, f: (s: Sub) => Sub) => commit(cats.map(c => c.id === cid ? { ...c, subtypes: c.subtypes.map(s => s.id === sid ? f(s) : s) } : c));
  const addSubSub = (cid: string, sid: string) => mapSub(cid, sid, s => ({ ...s, children: [...(s.children ?? []), { id: uid(), label: 'new item', iconName: 'Star' }] }));
  const delSubSub = (cid: string, sid: string, kid: string) => mapSub(cid, sid, s => ({ ...s, children: (s.children ?? []).filter(k => k.id !== kid) }));
  const updSubSub = (cid: string, sid: string, kid: string, label: string) => mapSub(cid, sid, s => ({ ...s, children: (s.children ?? []).map(k => k.id === kid ? { ...k, label } : k) }));
  const toggleExp = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const onKD = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); scrollRef.current?.scrollBy({ top: 90, behavior: 'smooth' }); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); scrollRef.current?.scrollBy({ top: -90, behavior: 'smooth' }); }
  };

  const openCtx = (e: React.MouseEvent, catId: string, subId?: string) => { e.preventDefault(); setCtx({ catId, subId, x: e.clientX, y: e.clientY }); };
  const ctxPick = (iconName: string) => { if (!ctx) return; ctx.subId ? updateSub(ctx.catId, ctx.subId, { iconName }) : updateCat(ctx.catId, { iconName }); };

  const totalCats = cardData.front.length + cardData.back.length;

  const navSlot = editorKey ? (
    <a href="#/preview" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--ec-card)', color: 'var(--ec-muted)', padding: '6px 14px', borderRadius: 999, textDecoration: 'none', fontWeight: 600, fontSize: 12, boxShadow: 'inset 0 0 0 1px var(--line)' }}>preview ↗</a>
  ) : null;

  if (step === 'key') {
    return (
      <div className="moira-kit-page">
        <KeyStep editorKey={editorKey} onBack={() => setStep('build')} onContinue={() => navigate('/preview')} />
      </div>
    );
  }

  return (
    <div className="moira-kit-page">
      <div style={{ display: 'flex', height: 'calc(100vh - 58px)', overflow: 'hidden' }}>

        {/* ── Left panel ── */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)', background: 'color-mix(in oklab, var(--bg) 80%, var(--ec-card) 20%)', outline: 'none' }} tabIndex={0} onKeyDown={onKD}>
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>build your map</h2>
              <button onClick={handleFlip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--ec-muted)', cursor: 'pointer' }}>
                <RotateCw size={11} /> flip
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['front', 'back'] as const).map(s => (
                <button key={s} onClick={() => { setSide(s); setFlipped(s === 'back'); }}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: side === s ? `color-mix(in oklab, var(--${s === 'front' ? 'p1' : 'p3'}) 25%, var(--ec-card) 75%)` : 'transparent',
                    color: side === s ? 'var(--ink)' : 'var(--ec-muted)',
                    boxShadow: side === s ? 'inset 0 0 0 1px var(--line)' : 'none',
                    textTransform: 'uppercase', letterSpacing: 1,
                  }}>
                  {s} · {cardData[s].length}
                </button>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ec-muted)' }}>right-click any icon to swap it</p>
          </div>

          <div ref={scrollRef} className="no-scrollbar" style={{ flex: 1, overflowY: 'scroll', padding: '12px 14px' }}>
            {cats.map(cat => {
              const CatIcon = ICON_MAP[cat.iconName] ?? LayoutGrid;
              const isOpen = expanded.has(cat.id);
              return (
                <div key={cat.id} style={{ marginBottom: 8 }}>
                  <div style={{ background: 'var(--ec-card)', borderRadius: 12, boxShadow: 'var(--elev-1)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px' }}>
                      <div onContextMenu={e => openCtx(e, cat.id)} title="right-click to change icon"
                        style={{ width: 38, height: 38, borderRadius: 11, background: `var(--${cat.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'context-menu', flexShrink: 0, userSelect: 'none' }}>
                        <CatIcon size={19} />
                      </div>
                      <input value={cat.label} onChange={e => updateCat(cat.id, { label: e.target.value })}
                        style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', minWidth: 0 }} />
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {ACCENTS.map(a => (
                          <button key={a} onClick={() => updateCat(cat.id, { accent: a })}
                            style={{ width: 13, height: 13, borderRadius: '50%', background: `var(--${a})`, border: cat.accent === a ? '2px solid var(--ink)' : '1px solid var(--line)', cursor: 'pointer', padding: 0 }} />
                        ))}
                      </div>
                      <button onClick={() => toggleExp(cat.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--ec-muted)', display: 'flex', alignItems: 'center', transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink: 0 }}>
                        <ChevronDown size={15} />
                      </button>
                      <button onClick={() => delCat(cat.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--ec-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div key="subs" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }} style={{ overflow: 'hidden', borderTop: '1px solid var(--line)' }}>
                          <div style={{ padding: '8px 10px 10px', background: 'color-mix(in oklab, var(--bg) 40%, transparent)' }}>
                            {cat.subtypes.map(sub => {
                              const SubIcon = ICON_MAP[sub.iconName] ?? Star;
                              return (
                                <div key={sub.id}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, paddingLeft: 10 }}>
                                  <div onContextMenu={e => openCtx(e, cat.id, sub.id)} title="right-click to change icon"
                                    style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in oklab, var(--${cat.accent}) 38%, var(--ec-card) 62%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'context-menu', flexShrink: 0, userSelect: 'none' }}>
                                    <SubIcon size={13} />
                                  </div>
                                  <input value={sub.label} onChange={e => updateSub(cat.id, sub.id, { label: e.target.value })}
                                    style={{ flex: 1, border: 'none', background: 'var(--ec-card)', borderRadius: 7, padding: '4px 8px', fontSize: 12, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxShadow: 'inset 0 0 0 1px var(--line)', minWidth: 0 }} />
                                  <button onClick={() => delSub(cat.id, sub.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--ec-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                    <Trash2 size={11} />
                                  </button>
                                  <button onClick={() => addSubSub(cat.id, sub.id)} title="add nested item"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--ec-muted)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                    <Plus size={11} />
                                  </button>
                                </div>
                                {(sub.children ?? []).map(k => (
                                  <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 5px 38px' }}>
                                    <span style={{ width: 8, borderTop: '1px dashed var(--line)' }} />
                                    <input value={k.label} onChange={e => updSubSub(cat.id, sub.id, k.id, e.target.value)}
                                      style={{ flex: 1, border: 'none', background: 'transparent', borderRadius: 6, padding: '3px 6px', fontSize: 11, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxShadow: 'inset 0 0 0 1px var(--line)', minWidth: 0 }} />
                                    <button onClick={() => delSubSub(cat.id, sub.id, k.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--ec-muted)', display: 'flex' }}><X size={10} /></button>
                                  </div>
                                ))}
                                </div>
                              );
                            })}
                            <button onClick={() => addSub(cat.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px dashed var(--line)', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: 'var(--ec-muted)', cursor: 'pointer', width: 'calc(100% - 10px)', marginTop: 4, marginLeft: 10 }}>
                              <Plus size={11} /> add subtype
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
            <button onClick={() => setShowPicker(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '11px 0', background: 'none', border: '1.5px dashed var(--line)', borderRadius: 12, fontSize: 13, color: 'var(--ec-muted)', cursor: 'pointer', marginTop: 4 }}>
              <Plus size={14} /> add category
            </button>
          </div>

          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--ec-muted)' }}>{totalCats} total · {side} side active</span>
              <span style={{ fontSize: 10, color: 'var(--ec-muted)', opacity: 0.5 }}>↑↓ scroll</span>
            </div>
            <button onClick={enterKeyStep} disabled={totalCats === 0}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: totalCats > 0 ? 'var(--ink)' : 'var(--ec-card)',
                color: totalCats > 0 ? 'var(--bg)' : 'var(--ec-muted)',
                border: 'none', borderRadius: 10, padding: '9px 0',
                fontSize: 12, fontWeight: 700, cursor: totalCats > 0 ? 'pointer' : 'not-allowed',
                opacity: totalCats === 0 ? 0.5 : 1,
              }}>
              <KeyRound size={13} /> next: save your editor key
            </button>
          </div>
        </div>

        {/* ── Right: Mindmap with ID Card at center ── */}
        <MindmapPreview cardData={cardData} flipped={flipped} onFlip={handleFlip} activeSide={side} />
      </div>

      <AnimatePresence>
        {showPicker && <TemplatePicker onPick={pickTemplate} />}
      </AnimatePresence>
      {ctx && <IconCtxMenu menu={ctx} onPick={ctxPick} onClose={() => setCtx(null)} />}
    </div>
  );
}
