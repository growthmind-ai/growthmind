"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from "react";

import styles from "./MorphSurface.module.css";

const TOOLBAR_RADIUS = 21;
const PANEL_RADIUS = 14;

export interface MorphSize {
  readonly width: number;
  readonly height: number;
}

export interface MorphControls<P extends string = string> {
  readonly openPanel: (name: P) => void;
  readonly back: () => void;
  readonly dismiss: () => void;
  readonly applied: (message: string) => void;
}

export interface MorphPanelDescriptor<P extends string = string> {
  readonly size: MorphSize;
  readonly label: string;
  readonly render: (controls: MorphControls<P>) => ReactNode;
  readonly onOpened?: () => void;
}

export interface MorphSurfaceProps<P extends string> {
  readonly toolbarSize: MorphSize;
  readonly toolbarLabel: string;
  readonly toolbar: (controls: MorphControls<P>) => ReactNode;
  readonly panels: Readonly<Record<P, MorphPanelDescriptor<P>>>;
  readonly className?: string;
  readonly children: ReactNode;
}

type Phase<P extends string> =
  | { readonly kind: "rest" }
  | { readonly kind: "active" }
  | { readonly kind: "panel"; readonly name: P }
  | { readonly kind: "applied"; readonly message: string };

const REST = { kind: "rest" } as const;
const ACTIVE = { kind: "active" } as const;

function joined(...classes: readonly (string | null)[]): string {
  return classes.filter((entry) => entry !== null).join(" ");
}

// The one engine behind every audience object: rest → affordance → panel → applied, morph
// by CSS transition, per-host content supplied as a descriptor the engine never inspects.
export function MorphSurface<P extends string>({
  toolbarSize,
  toolbarLabel,
  toolbar,
  panels,
  className,
  children,
}: MorphSurfaceProps<P>) {
  const [phase, setPhase] = useState<Phase<P>>(REST);
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef<P | null>(null);
  const labelId = useId();

  const open = phase.kind === "panel" ? phase : null;
  const engaged = phase.kind === "panel" || phase.kind === "active";

  const controls: MorphControls<P> = {
    openPanel: (name) => {
      openedRef.current = null;
      setPhase({ kind: "panel", name });
    },
    back: () => setPhase(ACTIVE),
    dismiss: () => setPhase(REST),
    applied: (message) => {
      setPhase({ kind: "applied", message });
      hostRef.current?.focus();
    },
  };

  useEffect(() => {
    if (!engaged) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPhase(REST);
      hostRef.current?.focus();
    };
    const onClickAway = (event: MouseEvent) => {
      const host = hostRef.current;
      if (host === null || (event.target instanceof Node && host.contains(event.target))) {
        return;
      }
      setPhase(REST);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClickAway);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClickAway);
    };
  }, [engaged]);

  const settle = (name: P) => {
    if (open === null || open.name !== name || openedRef.current === name) return;
    openedRef.current = name;
    panels[name].onOpened?.();
  };

  // Post-morph focus rides the transition itself, never a clock: the surface's height on
  // fine pointers, or the layer's own fade where the panel sizes itself (coarse pointers).
  const onMorphSettled = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (open === null) return;
    if (event.target !== surfaceRef.current || event.propertyName !== "height") return;
    settle(open.name);
  };

  // The first tap on touch reveals the toolbar and must never itself act; clicks landing
  // inside the surface belong to its buttons.
  const onHostClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (phase.kind !== "rest") return;
    const surface = surfaceRef.current;
    if (surface !== null && event.target instanceof Node && surface.contains(event.target)) {
      return;
    }
    setPhase(ACTIVE);
  };

  // Enter or Space on the focused host mirrors the first tap; keys pressed on the verbs
  // themselves stay theirs.
  const onHostKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (phase.kind === "rest") setPhase(ACTIVE);
  };

  const size = open === null ? toolbarSize : panels[open.name].size;
  const surfaceStyle = {
    "--morph-w": `${size.width}px`,
    "--morph-h": `${size.height}px`,
    "--morph-r": `${open === null ? TOOLBAR_RADIUS : PANEL_RADIUS}px`,
  } as CSSProperties;

  return (
    // The first tap must reveal rather than act, so the host cannot be a button; its click
    // and key handlers are the touch and keyboard mirrors of the CSS hover affordance.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={hostRef}
      // A semantic tag is no substitute here: details and fieldset carry native toggle or
      // form behaviour the state machine must own itself.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      // Focusable by design: reaching the host is what reveals the toolbar for keyboard
      // users (:focus-within), and Esc hands focus back here.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={joined(
        styles.host,
        engaged ? styles.engaged : null,
        phase.kind === "applied" ? styles.applied : null,
        className ?? null,
      )}
      // The UX contract puts the expanded flag on the owning card, not on a verb.
      // oxlint-disable-next-line jsx-a11y/role-supports-aria-props
      aria-expanded={open !== null}
      onClick={onHostClick}
      onKeyDown={onHostKeyDown}
    >
      {children}
      <div
        ref={surfaceRef}
        className={joined(styles.surface, open === null ? styles.toolbarShape : styles.panelShape)}
        style={surfaceStyle}
        role={open === null ? "toolbar" : "dialog"}
        aria-labelledby={labelId}
        onTransitionEnd={onMorphSettled}
      >
        {/* Named by a rendered element rather than an aria-label, so no copy ever sits in
            an attribute a session recorder cannot mask. */}
        <span id={labelId} className={styles.srOnly}>
          {open === null ? toolbarLabel : panels[open.name].label}
        </span>
        <div className={joined(styles.layer, open === null ? styles.show : null)}>
          <div className={styles.tools}>{toolbar(controls)}</div>
        </div>
        {(Object.keys(panels) as P[]).map((name) => (
          <div
            key={name}
            className={joined(
              styles.layer,
              open !== null && open.name === name ? styles.show : null,
            )}
            onTransitionEnd={(event) => {
              if (event.target !== event.currentTarget || event.propertyName !== "opacity") return;
              settle(name);
            }}
          >
            {panels[name].render(controls)}
          </div>
        ))}
      </div>
      <span
        className={joined(styles.saved, phase.kind === "applied" ? styles.show : null)}
        aria-live="polite"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setPhase(REST);
        }}
      >
        {phase.kind === "applied" ? phase.message : null}
      </span>
    </div>
  );
}
