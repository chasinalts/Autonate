// content.ts
declare var chrome: any;

// ----------------------------------------------------------------------
// TYPES & CONSTANTS
// ----------------------------------------------------------------------

enum ToolType {
    HIGHLIGHTER = 'highlighter',
    LINE = 'line',
    ARROW = 'arrow',
    XMARK = 'xmark',
    QUESTION = 'question',
    TEXT = 'text'
}

interface Point {
    x: number;
    y: number;
}

// ----------------------------------------------------------------------
// MAIN CONTROLLER
// ----------------------------------------------------------------------

class AutonateController {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private overlayCanvas: HTMLCanvasElement;
    private overlayCtx: CanvasRenderingContext2D;
    private originalImage: HTMLImageElement;

    // UI Elements
    private toolPalette: HTMLDivElement | null = null;

    // State
    private isLocked: boolean = false;
    private currentTool: ToolType = ToolType.HIGHLIGHTER; // Default tool
    private shape: 'circle' | 'square' | 'rectangle' | 'custom-box' = 'circle';
    private customBoxStart: Point | null = null;
    private customBoxEnd: Point | null = null;
    private blurRadius: number = 8;
    private focusRadius: number = 150;
    private stampSize: number = 24;
    private paletteScale: number = 0.5;
    private mousePos: Point = { x: 0, y: 0 };
    private lockPos: Point = { x: 0, y: 0 }; // Where focus was locked

    // Annotation State
    private currentColor: string = '#FF0055';
    private isDrawing: boolean = false;
    private startPoint: Point | null = null;
    private lastAnnotationCenter: Point | null = null;

    // Arrow Logic State
    private arrowPhase: 'drawing_circle' | 'drawing_line' | null = null;
    private arrowOriginRadius: number = 0;

    constructor(dataUrl: string) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['autonateShape', 'autonateBlur', 'autonateFocusRadius', 'autonatePaletteScale'], (result: any) => {
                if (result.autonateShape) this.shape = result.autonateShape;
                if (result.autonateBlur !== undefined) this.blurRadius = result.autonateBlur;
                if (result.autonateFocusRadius !== undefined) this.focusRadius = result.autonateFocusRadius;
                if (result.autonatePaletteScale !== undefined) this.paletteScale = result.autonatePaletteScale;
                this.start(dataUrl);
            });
        } else {
            this.start(dataUrl);
        }
    }

    private start(dataUrl: string) {
        this.originalImage = new Image();
        this.originalImage.onload = () => this.initCanvas();
        this.originalImage.src = dataUrl;
    }

    private initCanvas() {
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
        this.canvas.style.zIndex = '2147483646';
        this.canvas.style.cursor = this.shape === 'custom-box' ? 'crosshair' : 'none';

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;

        this.ctx = this.canvas.getContext('2d')!;
        this.ctx.scale(dpr, dpr);

        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.width = this.canvas.width;
        this.overlayCanvas.height = this.canvas.height;
        this.overlayCtx = this.overlayCanvas.getContext('2d')!;
        this.overlayCtx.scale(dpr, dpr);

        this.preRenderOverlay();
        document.body.appendChild(this.canvas);
        this.drawFocusFrame();
        this.bindEvents();
    }

    private preRenderOverlay() {
        this.overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.overlayCtx.drawImage(this.originalImage, 0, 0, window.innerWidth, window.innerHeight);

        const shouldBlur = this.blurRadius > 0 && !(this.shape === 'custom-box' && !this.isLocked);

        if (shouldBlur) {
            const tempCtx = this.overlayCanvas.getContext('2d')!;
            tempCtx.save();
            tempCtx.filter = `blur(${this.blurRadius}px)`;
            tempCtx.drawImage(this.originalImage, 0, 0, window.innerWidth, window.innerHeight);
            tempCtx.restore();
            tempCtx.filter = 'none';
        }

        this.overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.overlayCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    private bindEvents() {
        window.addEventListener('mousemove', (e) => {
            this.mousePos = { x: e.clientX, y: e.clientY };
            if (!this.isLocked) {
                requestAnimationFrame(() => this.drawFocusFrame());
            } else if (this.isDrawing && this.currentTool === ToolType.LINE) {
                this.drawFreehand(e.clientX, e.clientY);
            } else if (this.isDrawing && this.currentTool === ToolType.HIGHLIGHTER) {
                this.drawHighlighter(e.clientX, e.clientY);
            } else if (this.isDrawing && this.currentTool === ToolType.ARROW) {
                // Arrow preview (no-op for simplicity, final on release)
            }
        });

        window.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!this.isLocked) {
                if (this.shape === 'custom-box') return; // Cannot mouse-wheel resize a custom box mode

                const delta = Math.sign(e.deltaY) * -10;
                this.focusRadius = Math.max(25, Math.min(this.focusRadius + delta, 600));

                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({ autonateFocusRadius: this.focusRadius });
                }

                requestAnimationFrame(() => this.drawFocusFrame());
            } else {
                const delta = Math.sign(e.deltaY) * -2;
                // Negative wheel = up = bigger, Positive = down = smaller. Reverse: deltaY < 0 means * -2 > 0 -> larger
                this.stampSize = Math.max(4, Math.min(this.stampSize + delta, 200));
                this.updateCursor();
            }
        }, { passive: false });

        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!this.isLocked) {
                if (this.shape === 'custom-box') {
                    if (this.customBoxStart) {
                        this.customBoxStart = null;
                        requestAnimationFrame(() => this.drawFocusFrame());
                    }
                } else {
                    this.lockFocus();
                }
            } else {
                // Second right click: Copy or Save, then Close
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(['autonateDefaultAction'], (result: any) => {
                        const action = result.autonateDefaultAction || 'copy';
                        if (action === 'copy') {
                            this.copyToClipboard();
                        } else {
                            this.exportCanvas();
                        }
                    });
                } else {
                    this.copyToClipboard();
                }
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.isLocked) {
                if (this.shape === 'custom-box') {
                    if (!this.customBoxStart) {
                        this.customBoxStart = { x: e.clientX, y: e.clientY };
                        requestAnimationFrame(() => this.drawFocusFrame());
                    } else {
                        // Second click locks the dimension box permanently
                        this.customBoxEnd = { x: e.clientX, y: e.clientY };
                        this.lockFocus();
                    }
                }
                return;
            }
            if (!this.currentTool) return;
            this.handleMouseDown(e);
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (!this.isLocked) return;
            if (!this.currentTool) return;
            this.handleMouseUp(e);
        });

        // ESC to close
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.cleanup();
            }
        });
    }

    // ----------------------------------------------------------------------
    // PHASE 1: FOCUS / FLASHLIGHT
    // ----------------------------------------------------------------------

    private drawFocusFrame() {
        if (this.isLocked) return;
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.ctx.drawImage(this.overlayCanvas, 0, 0, window.innerWidth, window.innerHeight);

        if (this.shape === 'custom-box' && !this.customBoxStart) {
            // Screen is just dimmed, native crosshair shows where to start boundary
            return;
        }

        this.ctx.save();
        this.ctx.beginPath();
        const x = this.mousePos.x;
        const y = this.mousePos.y;

        if (this.shape === 'custom-box' && this.customBoxStart) {
            const sx = this.customBoxStart.x;
            const sy = this.customBoxStart.y;
            this.ctx.rect(Math.min(sx, x), Math.min(sy, y), Math.abs(x - sx), Math.abs(y - sy));
        } else {
            const r = this.focusRadius;
            this.clipFocusShape(x, y, r);
        }

        this.ctx.clip();
        this.ctx.drawImage(this.originalImage, 0, 0, window.innerWidth, window.innerHeight);
        this.ctx.restore();

        // Border
        this.ctx.save();
        this.ctx.beginPath();
        if (this.shape === 'custom-box' && this.customBoxStart) {
            const sx = this.customBoxStart.x;
            const sy = this.customBoxStart.y;
            this.ctx.rect(Math.min(sx, x), Math.min(sy, y), Math.abs(x - sx), Math.abs(y - sy));
        } else {
            const r = this.focusRadius;
            this.clipFocusShape(x, y, r);
        }
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.restore();

        // Render 1st Anchor Dot for custom box
        if (this.shape === 'custom-box' && this.customBoxStart) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.beginPath();
            this.ctx.arc(this.customBoxStart.x, this.customBoxStart.y, 4, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    private clipFocusShape(x: number, y: number, r: number) {
        if (this.shape === 'circle') {
            this.ctx.arc(x, y, r, 0, Math.PI * 2);
        } else if (this.shape === 'square') {
            this.ctx.rect(x - r, y - r, r * 2, r * 2);
        } else {
            this.ctx.rect(x - r * 1.5, y - r, r * 3, r * 2);
        }
    }

    private lockFocus() {
        this.isLocked = true;

        if (this.shape === 'custom-box' && this.customBoxStart && this.customBoxEnd) {
            // Anchor lock position strictly between the box constraints
            this.lockPos = {
                x: (this.customBoxStart.x + this.customBoxEnd.x) / 2,
                y: (this.customBoxStart.y + this.customBoxEnd.y) / 2
            };
        } else {
            this.lockPos = { ...this.mousePos };
        }

        if (this.shape === 'custom-box') {
            this.preRenderOverlay();
        }

        this.canvas.style.cursor = 'default';

        // Redraw locked frame
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.ctx.drawImage(this.overlayCanvas, 0, 0, window.innerWidth, window.innerHeight);
        this.ctx.save();
        this.ctx.beginPath();

        if (this.shape === 'custom-box' && this.customBoxStart && this.customBoxEnd) {
            const sx = this.customBoxStart.x;
            const sy = this.customBoxStart.y;
            const ex = this.customBoxEnd.x;
            const ey = this.customBoxEnd.y;
            this.ctx.rect(Math.min(sx, ex), Math.min(sy, ey), Math.abs(ex - sx), Math.abs(ey - sy));
        } else {
            this.clipFocusShape(this.lockPos.x, this.lockPos.y, this.focusRadius);
        }

        this.ctx.clip();
        this.ctx.drawImage(this.originalImage, 0, 0, window.innerWidth, window.innerHeight);
        this.ctx.restore();

        // Border
        this.ctx.save();
        this.ctx.beginPath();

        if (this.shape === 'custom-box' && this.customBoxStart && this.customBoxEnd) {
            const sx = this.customBoxStart.x;
            const sy = this.customBoxStart.y;
            const ex = this.customBoxEnd.x;
            const ey = this.customBoxEnd.y;
            this.ctx.rect(Math.min(sx, ex), Math.min(sy, ey), Math.abs(ex - sx), Math.abs(ey - sy));
        } else {
            this.clipFocusShape(this.lockPos.x, this.lockPos.y, this.focusRadius);
        }

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.restore();

        this.showToolPalette();
        this.updateCursor();
    }

    private updateCursor() {
        if (!this.isLocked || !this.currentTool) return;

        let svgContent = '';
        const size = this.stampSize;
        const color = this.currentColor;

        const viewBoxSize = size * 2 + 20;
        const center = viewBoxSize / 2;

        if (this.currentTool === ToolType.HIGHLIGHTER) {
            svgContent = `<circle cx="${center}" cy="${center}" r="${size / 2}" fill="${color}" opacity="0.5" />`;
        } else if (this.currentTool === ToolType.LINE) {
            svgContent = `<circle cx="${center}" cy="${center}" r="${Math.max(1, size / 4)}" fill="${color}" opacity="0.5" />`;
        } else if (this.currentTool === ToolType.TEXT) {
            svgContent = `<text x="${center}" y="${center}" font-family="sans-serif" font-weight="bold" font-size="${size}px" fill="${color}" opacity="0.5" text-anchor="middle" dominant-baseline="central">T</text>`;
        } else if (this.currentTool === ToolType.QUESTION) {
            svgContent = `<text x="${center}" y="${center}" font-family="sans-serif" font-weight="bold" font-size="${size * 2}px" fill="${color}" opacity="0.5" text-anchor="middle" dominant-baseline="central">?</text>`;
        } else if (this.currentTool === ToolType.XMARK) {
            svgContent = `<path d="M${center - size / 2},${center - size / 2} L${center + size / 2},${center + size / 2} M${center + size / 2},${center - size / 2} L${center - size / 2},${center + size / 2}" stroke="${color}" stroke-width="${Math.max(2, size / 2)}" stroke-linecap="round" opacity="0.5" />`;
        } else if (this.currentTool === ToolType.ARROW) {
            svgContent = `<path d="M${center - size / 2},${center + size / 2} L${center + size / 2},${center - size / 2} M${center + size / 2},${center - size / 2} L${center},${center - size / 2} M${center + size / 2},${center - size / 2} L${center + size / 2},${center}" stroke="${color}" stroke-width="${Math.max(2, size / 4)}" fill="none" opacity="0.5" stroke-linejoin="round" stroke-linecap="round" />`;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBoxSize}" height="${viewBoxSize}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}">${svgContent}</svg>`;
        const encoded = btoa(unescape(encodeURIComponent(svg)));
        this.canvas.style.cursor = `url('data:image/svg+xml;base64,${encoded}') ${center} ${center}, crosshair`;
    }

    // ----------------------------------------------------------------------
    // PHASE 2: TOOL PALETTE (Floating near focus area)
    // ----------------------------------------------------------------------

    private showToolPalette() {
        this.toolPalette = document.createElement('div');

        // Position palette perfectly anchored to the middle-left side of the screen
        let paletteX = 15;
        let paletteY = (window.innerHeight / 2) - (260 * this.paletteScale); // Centered vertically subtracting half of its approximate height

        this.toolPalette.style.cssText = `
            position: fixed;
            top: ${paletteY}px;
            left: ${paletteX}px;
            display: flex;
        flex-direction: column;
        gap: ${Math.max(2, 6 * this.paletteScale)}px;
        padding: ${Math.max(4, 10 * this.paletteScale)}px;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(100, 180, 255, 0.2);
        border-radius: ${Math.max(4, 14 * this.paletteScale)}px;
        z-index: 2147483647;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        // Color picker at top
        const colorRow = document.createElement('div');
        colorRow.style.cssText = `display:flex; justify-content:center; padding-bottom:${Math.max(1, 4 * this.paletteScale)}px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:${Math.max(1, 2 * this.paletteScale)}px;`;
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.currentColor;
        colorInput.style.cssText = `width:${Math.max(16, 32 * this.paletteScale)}px; height:${Math.max(16, 32 * this.paletteScale)}px; cursor:pointer; border:none; padding:0; background:none; border-radius:${Math.max(3, 6 * this.paletteScale)}px;`;
        colorInput.onchange = (e) => {
            this.currentColor = (e.target as HTMLInputElement).value;
            this.updateCursor();
        };
        colorInput.title = 'Pick Color';
        colorRow.appendChild(colorInput);
        this.toolPalette.appendChild(colorRow);

        const tools: { tool: ToolType; icon: string; label: string }[] = [
            { tool: ToolType.HIGHLIGHTER, icon: '🖊️', label: 'Highlight' },
            { tool: ToolType.LINE, icon: '✏️', label: 'Draw' },
            { tool: ToolType.ARROW, icon: '↗️', label: 'Arrow' },
            { tool: ToolType.TEXT, icon: 'T', label: 'Text' },
            { tool: ToolType.XMARK, icon: '✖', label: 'X Mark' },
            { tool: ToolType.QUESTION, icon: '❓', label: 'Question' },
        ];

        tools.forEach(({ tool, icon, label }) => {
            const btn = document.createElement('button');
            btn.innerHTML = `<span style="font-size:${Math.max(9, 18 * this.paletteScale)}px;">${icon}</span>`;
            btn.title = label;
            btn.dataset.tool = tool;
            btn.style.cssText = `
            width: ${Math.max(22, 44 * this.paletteScale)}px;
            height: ${Math.max(22, 44 * this.paletteScale)}px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: ${Math.max(4, 10 * this.paletteScale)}px;
            background: rgba(30, 41, 59, 0.8);
            cursor: pointer;
            transition: all 0.15s ease;
            color: white;
        `;

            btn.onmouseenter = () => {
                if (this.currentTool !== tool) {
                    btn.style.background = 'rgba(6, 182, 212, 0.2)';
                    btn.style.borderColor = 'rgba(6, 182, 212, 0.4)';
                }
            };
            btn.onmouseleave = () => {
                if (this.currentTool !== tool) {
                    btn.style.background = 'rgba(30, 41, 59, 0.8)';
                    btn.style.borderColor = 'rgba(255,255,255,0.1)';
                }
            };

            btn.onclick = () => {
                this.currentTool = tool;
                this.updateCursor();

                // Update all button styles
                this.toolPalette!.querySelectorAll('button[data-tool]').forEach((b) => {
                    const el = b as HTMLElement;
                    el.style.background = 'rgba(30, 41, 59, 0.8)';
                    el.style.borderColor = 'rgba(255,255,255,0.1)';
                    el.style.boxShadow = 'none';
                });
                btn.style.background = 'rgba(6, 182, 212, 0.3)';
                btn.style.borderColor = '#06b6d4';
                btn.style.boxShadow = '0 0 12px rgba(6, 182, 212, 0.3)';
            };

            this.toolPalette!.appendChild(btn);
        });

        document.body.appendChild(this.toolPalette);
    }

    // ----------------------------------------------------------------------
    // PHASE 3: ANNOTATION LOGIC
    // ----------------------------------------------------------------------

    private handleMouseDown(e: MouseEvent) {
        this.isDrawing = true;
        this.startPoint = { x: e.clientX, y: e.clientY };

        if (this.currentTool === ToolType.XMARK) {
            this.drawXMark(e.clientX, e.clientY);
            this.isDrawing = false;
            this.lastAnnotationCenter = { x: e.clientX, y: e.clientY };
        } else if (this.currentTool === ToolType.QUESTION) {
            this.drawQuestionMark(e.clientX, e.clientY);
            this.isDrawing = false;
            this.lastAnnotationCenter = { x: e.clientX, y: e.clientY };
        } else if (this.currentTool === ToolType.TEXT) {
            this.startTextTool(e.clientX, e.clientY);
            this.isDrawing = false;
        } else if (this.currentTool === ToolType.LINE || this.currentTool === ToolType.HIGHLIGHTER) {
            this.ctx.beginPath();
            this.ctx.moveTo(e.clientX, e.clientY);
        } else if (this.currentTool === ToolType.ARROW) {
            this.arrowPhase = 'drawing_circle';
        }
    }

    private handleMouseUp(e: MouseEvent) {
        if (this.currentTool === ToolType.ARROW && this.arrowPhase === 'drawing_circle') {
            this.arrowPhase = 'drawing_line';
            const dx = e.clientX - this.startPoint!.x;
            const dy = e.clientY - this.startPoint!.y;
            this.arrowOriginRadius = Math.sqrt(dx * dx + dy * dy);
            return;
        }

        if (this.currentTool === ToolType.ARROW && this.arrowPhase === 'drawing_line') {
            this.drawArrowFinal(this.startPoint!, this.arrowOriginRadius, { x: e.clientX, y: e.clientY });
            this.arrowPhase = null;
            this.lastAnnotationCenter = { ...this.startPoint! };
            this.isDrawing = false;
            this.ctx.beginPath();
            return;
        }

        if (this.currentTool === ToolType.LINE || this.currentTool === ToolType.HIGHLIGHTER) {
            // End of freehand stroke
            const midX = (this.startPoint!.x + e.clientX) / 2;
            const midY = (this.startPoint!.y + e.clientY) / 2;
            this.lastAnnotationCenter = { x: midX, y: midY };
            this.isDrawing = false;
            this.ctx.beginPath();
            return;
        }

        this.isDrawing = false;
        this.ctx.beginPath();
    }

    // --- Tool: Freehand ---
    private drawFreehand(x: number, y: number) {
        this.ctx.lineWidth = Math.max(2, this.stampSize / 2);
        this.ctx.lineCap = 'round';
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.globalAlpha = 1.0;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
    }

    // --- Tool: Highlighter ---
    private drawHighlighter(x: number, y: number) {
        this.ctx.lineWidth = this.stampSize;
        this.ctx.lineCap = 'square';
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.globalAlpha = 0.4;
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.globalAlpha = 1.0;
    }

    // --- Tool: X Mark ---
    private drawXMark(x: number, y: number) {
        const size = this.stampSize / 2;
        this.ctx.save();
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = Math.max(2, this.stampSize / 2); // Match exact custom SVG stroke logic
        this.ctx.lineCap = 'round';

        this.ctx.beginPath();
        this.ctx.moveTo(x - size, y - size);
        this.ctx.lineTo(x + size, y + size);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.moveTo(x + size, y - size);
        this.ctx.lineTo(x - size, y + size);
        this.ctx.stroke();

        this.ctx.restore();
    }

    // --- Tool: Question Mark ---
    private drawQuestionMark(x: number, y: number) {
        this.ctx.save();
        this.ctx.font = `bold ${this.stampSize * 2}px -apple-system, BlinkMacSystemFont, sans-serif`;
        this.ctx.fillStyle = this.currentColor;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('?', x, y);

        // Outline for thickness
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = 2;
        this.ctx.strokeText('?', x, y);
        this.ctx.restore();
    }

    // --- Tool: Arrow ---
    private drawArrowFinal(center: Point, radius: number, dest: Point) {
        this.ctx.save();
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.fillStyle = this.currentColor;
        this.ctx.lineWidth = Math.max(2, this.stampSize / 4);
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // Base circle
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Line from circle edge to destination
        const dx = dest.x - center.x;
        const dy = dest.y - center.y;
        const theta = Math.atan2(dy, dx);
        const startX = center.x + radius * Math.cos(theta);
        const startY = center.y + radius * Math.sin(theta);

        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(dest.x, dest.y);
        this.ctx.stroke();

        // Arrowhead
        const headLen = Math.max(10, this.stampSize / 1.5);
        this.ctx.beginPath();
        this.ctx.moveTo(dest.x, dest.y);
        this.ctx.lineTo(
            dest.x - headLen * Math.cos(theta - Math.PI / 6),
            dest.y - headLen * Math.sin(theta - Math.PI / 6)
        );
        this.ctx.lineTo(
            dest.x - headLen * Math.cos(theta + Math.PI / 6),
            dest.y - headLen * Math.sin(theta + Math.PI / 6)
        );
        this.ctx.closePath();
        this.ctx.fill();
    }

    // --- Tool: Text ---
    private startTextTool(x: number, y: number) {
        this.isDrawing = false;

        const textArea = document.createElement('div');
        textArea.contentEditable = 'true';
        textArea.style.position = 'fixed';
        textArea.style.left = `${x}px`;
        textArea.style.top = `${y}px`;
        textArea.style.color = this.currentColor;
        textArea.style.fontSize = `${this.stampSize}px`;
        textArea.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";
        textArea.style.backgroundColor = 'transparent';
        textArea.style.border = '1px dashed rgba(255, 255, 255, 0.5)';
        textArea.style.padding = '4px 8px';
        textArea.style.margin = '0';
        textArea.style.outline = 'none';
        textArea.style.resize = 'both';
        textArea.style.overflow = 'hidden';
        textArea.style.whiteSpace = 'pre-wrap';
        textArea.style.wordBreak = 'break-word';
        textArea.style.zIndex = '2147483647';
        textArea.style.minWidth = '50px';
        textArea.style.minHeight = `${this.stampSize + 10}px`;
        textArea.style.maxWidth = `${window.innerWidth - x - 20}px`;
        textArea.style.maxHeight = `${window.innerHeight - y - 20}px`;
        textArea.style.display = 'inline-block';
        textArea.style.pointerEvents = 'auto'; // Explicitly allow mouse resizing interactions inside the canvas

        // Force overall canvas behind the text box so handles work uninterrupted
        this.canvas.style.pointerEvents = 'none';

        let userResized = false;

        textArea.addEventListener('mouseup', () => {
            if (textArea.style.width || textArea.style.height) {
                userResized = true;
            }
        });

        const finalizeText = () => {
            if (!textArea.parentElement) return;
            const text = textArea.innerText;
            const rect = textArea.getBoundingClientRect();

            if (text.trim()) {
                this.ctx.save();
                this.ctx.font = `${this.stampSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
                this.ctx.fillStyle = this.currentColor;
                this.ctx.textBaseline = 'top';

                const lines = text.split('\n');
                let currentY = rect.top + 4; // padding match

                const maxWidth = rect.width - 16; // padding match
                const lineHeight = this.stampSize * 1.2;

                for (const rawLine of lines) {
                    if (!rawLine) {
                        currentY += lineHeight;
                        continue;
                    }

                    let words = rawLine.split(' ');
                    let currentLine = '';

                    for (let i = 0; i < words.length; i++) {
                        const testLine = currentLine + words[i] + ' ';
                        const metrics = this.ctx.measureText(testLine);
                        if (metrics.width > maxWidth && i > 0) {
                            this.ctx.fillText(currentLine, rect.left + 8, currentY);
                            currentLine = words[i] + ' ';
                            currentY += lineHeight;
                        } else {
                            currentLine = testLine;
                        }
                    }
                    this.ctx.fillText(currentLine, rect.left + 8, currentY);
                    currentY += lineHeight;
                }
                this.ctx.restore();
            }
            textArea.remove();
            this.canvas.style.pointerEvents = 'auto'; // Restore normal canvas interactivity
        };

        textArea.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finalizeText();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                textArea.remove();
                this.canvas.style.pointerEvents = 'auto';
                this.cleanup(); // Close extension globally per configuration preference
            }
        });

        textArea.addEventListener('blur', finalizeText);

        document.body.appendChild(textArea);
        setTimeout(() => textArea.focus(), 10);
    }

    // ----------------------------------------------------------------------
    // PHASE 4: CLIPBOARD & EXPORT
    // ----------------------------------------------------------------------

    private roundRect(x: number, y: number, w: number, h: number, r: number) {
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    // ----------------------------------------------------------------------
    // PHASE 5: EXPORT / COPY
    // ----------------------------------------------------------------------

    private async copyToClipboard() {
        try {
            const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error("Canvas to Blob failed");
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
        } catch (err) {
            console.error('Clipboard write failed:', err);
        } finally {
            this.cleanup();
        }
    }

    private exportCanvas() {
        const link = document.createElement('a');
        link.download = `autonate-capture-${Date.now()}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
        this.cleanup();
    }

    private cleanup() {
        this.canvas.remove();
        if (this.toolPalette) this.toolPalette.remove();
        // Remove any lingering indicators
        document.querySelectorAll('[data-autonate]').forEach(el => el.remove());
        (window as any).autonateInstance = null;
    }
}

// ----------------------------------------------------------------------
// INITIALIZATION LISTENER
// ----------------------------------------------------------------------

if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
        if (request.action === "INIT_AUTONATE" && request.payload) {
            if ((window as any).autonateInstance) return;
            (window as any).autonateInstance = new AutonateController(request.payload);
        }
    });
}