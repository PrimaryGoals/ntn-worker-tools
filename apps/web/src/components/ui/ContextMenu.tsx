import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A menu positioned at the pointer. Unlike the header dropdown — which is
// anchored in the layout and can get away with closing on mouse-leave — this
// one floats over the page, so it has to handle dismissal and viewport edges
// itself.
export function ContextMenu({
	x,
	y,
	onClose,
	children,
}: {
	x: number;
	y: number;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: x, top: y });

	// Measured in a layout effect so the flip happens before the browser
	// paints — a menu opened near the bottom-right never flashes off-screen.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const margin = 4;
		const { width, height } = el.getBoundingClientRect();
		setPos({
			left: x + width + margin > window.innerWidth ? Math.max(margin, x - width) : x,
			top: y + height + margin > window.innerHeight ? Math.max(margin, y - height) : y,
		});
	}, [x, y]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		function onPointerDown(e: PointerEvent) {
			if (!ref.current?.contains(e.target as Node)) onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		// Capture phase: the menu closes before the click reaches whatever sits
		// underneath it, so dismissing never doubles as clicking something else.
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("resize", onClose);
		// Capture phase again — the sidebar is its own scroll container, and
		// scrolling it would otherwise strand the menu away from its row.
		window.addEventListener("scroll", onClose, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("resize", onClose);
			window.removeEventListener("scroll", onClose, true);
		};
	}, [onClose]);

	return (
		<div
			ref={ref}
			role="menu"
			style={{ left: pos.left, top: pos.top }}
			className="fixed z-50 w-64 rounded border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
		>
			{children}
		</div>
	);
}
