// content.ts
declare var chrome: any;

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

interface Annotation {
    id: string;
    type: ToolType;
    color: string;
    thickness: number;
    size: number;

    points?: Point[];
    start?: Point;
    end?: Point;
    center?: Point;

    text?: string;
    textWidth?: number;
    textHeight?: number;
}

class AutonateController {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private overlayCanvas: HTMLCanvasElement;
    private overlayCtx: CanvasRenderingContext2D;
    private originalImage: HTMLImageElement;

    private toolPalette: HTMLDivElement | null = null;
    private activeTextArea: HTMLDivElement | null = null;

    // State
    private isLocked: boolean = false;
    private currentTool: ToolType | null = null;
    private shape: 'circle' | 'square' | 'rectangle' | 'custom-box' = 'circle';
    private customBoxStart: Point | null = null;
    private customBoxEnd: Point | null = null;
    private blurRadius: number = 8;
    private focusRadius: number = 150;
    private stampSize: number = 24;
    private currentThickness: number = 4;
    private paletteScale: number = 0.75;
    private mousePos: Point = { x: 0, y: 0 };
    private lockPos: Point = { x: 0, y: 0 };

    // Annotation Data
    private annotations: Annotation[] = [];
    private undoStack: Annotation[][] = [];
    private redoStack: Annotation[][] = [];
    private currentAnnotation: Annotation | null = null;
    private selectedAnnotation: Annotation | null = null;
    private draggingHandle: 'move' | 'start' | 'end' | 'resize' | 'none' = 'none';
    private dragOffset: Point = { x: 0, y: 0 };

    private isDrawing: boolean = false;
    private startPoint: Point | null = null;

    // Tools UI State
    private currentColor: string = '#FF0055';

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
        this.redraw();
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
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        window.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
        window.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    private redraw() {
        if (!this.isLocked) {
            // Draw Focus Frame preview
            this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            this.ctx.drawImage(this.overlayCanvas, 0, 0, window.innerWidth, window.innerHeight);
            if (this.shape === 'custom-box' && !this.customBoxStart) return;

            this.ctx.save();
            this.ctx.beginPath();
            const x = this.mousePos.x;
            const y = this.mousePos.y;

            if (this.shape === 'custom-box' && this.customBoxStart) {
                const sx = this.customBoxStart.x;
                const sy = this.customBoxStart.y;
                this.ctx.rect(Math.min(sx, x), Math.min(sy, y), Math.abs(x - sx), Math.abs(y - sy));
            } else {
                this.clipFocusShape(x, y, this.focusRadius);
            }

            this.ctx.clip();
            this.ctx.drawImage(this.originalImage, 0, 0, window.innerWidth, window.innerHeight);
            this.ctx.restore();

            this.ctx.save();
            this.ctx.beginPath();
            if (this.shape === 'custom-box' && this.customBoxStart) {
                const sx = this.customBoxStart.x;
                const sy = this.customBoxStart.y;
                this.ctx.rect(Math.min(sx, x), Math.min(sy, y), Math.abs(x - sx), Math.abs(y - sy));
            } else {
                this.clipFocusShape(x, y, this.focusRadius);
            }
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.restore();

            if (this.shape === 'custom-box' && this.customBoxStart) {
                this.ctx.save();
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                this.ctx.beginPath();
                this.ctx.arc(this.customBoxStart.x, this.customBoxStart.y, 4, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
            }
            return;
        }

        // --- RETAINED MODE REDRAW ---
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

        // Draw Annotations
        for (const ann of this.annotations) {
            this.drawAnnotation(ann);
        }

        if (this.isDrawing && this.currentAnnotation) {
            this.drawAnnotation(this.currentAnnotation);
        }

        if (this.selectedAnnotation) {
            this.drawSelection(this.selectedAnnotation);
        }
    }

    private drawAnnotation(ann: Annotation) {
        this.ctx.save();
        this.ctx.strokeStyle = ann.color;
        this.ctx.fillStyle = ann.color;

        // Hide canvas text if actively editing it
        if (ann.type === ToolType.TEXT && this.activeTextArea && this.selectedAnnotation?.id === ann.id) {
            this.ctx.restore();
            return;
        }

        if (ann.type === ToolType.LINE || ann.type === ToolType.HIGHLIGHTER) {
            if (ann.points && ann.points.length > 0) {
                this.ctx.lineWidth = ann.type === ToolType.HIGHLIGHTER ? ann.thickness * 4 : ann.thickness; // Highlighter is thicker natively
                this.ctx.lineCap = ann.type === ToolType.HIGHLIGHTER ? 'square' : 'round';
                this.ctx.globalAlpha = ann.type === ToolType.HIGHLIGHTER ? 0.4 : 1.0;

                this.ctx.beginPath();
                this.ctx.moveTo(ann.points[0].x, ann.points[0].y);
                for (let i = 1; i < ann.points.length; i++) {
                    this.ctx.lineTo(ann.points[i].x, ann.points[i].y);
                }
                this.ctx.stroke();
            }
        } else if (ann.type === ToolType.ARROW) {
            if (ann.start && ann.end) {
                this.ctx.lineWidth = ann.thickness;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';

                const dx = ann.end.x - ann.start.x;
                const dy = ann.end.y - ann.start.y;
                const theta = Math.atan2(dy, dx);
                const headLen = Math.max(10, ann.thickness * 3);

                this.ctx.beginPath();
                this.ctx.moveTo(ann.start.x, ann.start.y);
                this.ctx.lineTo(ann.end.x, ann.end.y);
                this.ctx.stroke();

                this.ctx.beginPath();
                this.ctx.moveTo(ann.end.x, ann.end.y);
                this.ctx.lineTo(ann.end.x - headLen * Math.cos(theta - Math.PI / 6), ann.end.y - headLen * Math.sin(theta - Math.PI / 6));
                this.ctx.lineTo(ann.end.x - headLen * Math.cos(theta + Math.PI / 6), ann.end.y - headLen * Math.sin(theta + Math.PI / 6));
                this.ctx.closePath();
                this.ctx.fill();
            }
        } else if (ann.type === ToolType.XMARK) {
            if (ann.center) {
                const s = ann.size / 2;
                this.ctx.lineWidth = ann.thickness;
                this.ctx.lineCap = 'round';
                this.ctx.beginPath();
                this.ctx.moveTo(ann.center.x - s, ann.center.y - s);
                this.ctx.lineTo(ann.center.x + s, ann.center.y + s);
                this.ctx.stroke();
                this.ctx.beginPath();
                this.ctx.moveTo(ann.center.x + s, ann.center.y - s);
                this.ctx.lineTo(ann.center.x - s, ann.center.y + s);
                this.ctx.stroke();
            }
        } else if (ann.type === ToolType.QUESTION) {
            if (ann.center) {
                this.ctx.font = `bold ${ann.size * 2}px -apple-system, BlinkMacSystemFont, sans-serif`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('?', ann.center.x, ann.center.y);
                this.ctx.lineWidth = 2;
                this.ctx.strokeText('?', ann.center.x, ann.center.y);
            }
        } else if (ann.type === ToolType.TEXT) {
            if (ann.start && ann.textWidth && ann.textHeight) {
                this.ctx.beginPath();
                this.ctx.rect(ann.start.x, ann.start.y, ann.textWidth, ann.textHeight);
                this.ctx.clip();

                // Background helper for readability
                this.ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
                this.ctx.fill();

                this.ctx.font = `bold ${ann.size}px -apple-system, BlinkMacSystemFont, sans-serif`;
                this.ctx.fillStyle = ann.color;
                this.ctx.textBaseline = 'top';

                const lines = (ann.text || '').split('\n');
                let currentY = ann.start.y + 6;
                const lineHeight = ann.size * 1.2;

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
                        if (metrics.width > ann.textWidth - 16 && i > 0) {
                            this.ctx.fillText(currentLine, ann.start.x + 8, currentY);
                            currentLine = words[i] + ' ';
                            currentY += lineHeight;
                        } else {
                            currentLine = testLine;
                        }
                    }
                    this.ctx.fillText(currentLine, ann.start.x + 8, currentY);
                    currentY += lineHeight;
                }
            }
        }
        this.ctx.restore();
    }

    private drawSelection(ann: Annotation) {
        this.ctx.save();
        this.ctx.strokeStyle = '#06b6d4';
        this.ctx.lineWidth = 2;

        const drawHandle = (x: number, y: number) => {
            this.ctx.beginPath();
            this.ctx.arc(x, y, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = '#fff';
            this.ctx.fill();
            this.ctx.stroke();
        };

        if (ann.type === ToolType.ARROW) {
            drawHandle(ann.start!.x, ann.start!.y);
            drawHandle(ann.end!.x, ann.end!.y);
        } else if (ann.type === ToolType.TEXT) {
            this.ctx.setLineDash([4, 4]);
            this.ctx.strokeRect(ann.start!.x, ann.start!.y, ann.textWidth!, ann.textHeight!);
            this.ctx.setLineDash([]);
            drawHandle(ann.start!.x + ann.textWidth!, ann.start!.y + ann.textHeight!); // Resize handle
        } else if (ann.type === ToolType.XMARK || ann.type === ToolType.QUESTION) {
            this.ctx.setLineDash([4, 4]);
            const s = ann.size;
            this.ctx.strokeRect(ann.center!.x - s, ann.center!.y - s, s * 2, s * 2);
        } else if (ann.type === ToolType.LINE || ann.type === ToolType.HIGHLIGHTER) {
            // Compute bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            ann.points!.forEach(p => {
                if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
            });
            this.ctx.setLineDash([4, 4]);
            this.ctx.strokeRect(minX - 5, minY - 5, maxX - minX + 10, maxY - minY + 10);
        }
        this.ctx.restore();
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

    // --- State Management ---
    private saveState() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.annotations)));
        this.redoStack = [];
    }

    private undo() {
        if (this.undoStack.length > 0) {
            this.redoStack.push(JSON.parse(JSON.stringify(this.annotations)));
            this.annotations = this.undoStack.pop()!;

            if (this.selectedAnnotation) {
                // Check if selected still exists
                const stillExists = this.annotations.find(a => a.id === this.selectedAnnotation!.id);
                if (!stillExists) this.selectedAnnotation = null;
            }
            this.redraw();
        }
    }

    private redo() {
        if (this.redoStack.length > 0) {
            this.undoStack.push(JSON.parse(JSON.stringify(this.annotations)));
            this.annotations = this.redoStack.pop()!;
            this.redraw();
        }
    }

    // --- Logic Handlers ---
    private lockFocus() {
        this.isLocked = true;
        if (this.shape === 'custom-box' && this.customBoxStart && this.customBoxEnd) {
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
        this.showToolPalette();
        this.redraw();
        this.updateCursor();
    }

    private getHitAnnotation(x: number, y: number): { annotation: Annotation, handle?: 'start' | 'end' | 'resize' } | null {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const ann = this.annotations[i];
            // Check Handles if selected securely first
            if (this.selectedAnnotation && this.selectedAnnotation.id === ann.id) {
                if (ann.type === ToolType.ARROW) {
                    if (this.dist(x, y, ann.start!.x, ann.start!.y) < 12) return { annotation: ann, handle: 'start' };
                    if (this.dist(x, y, ann.end!.x, ann.end!.y) < 12) return { annotation: ann, handle: 'end' };
                }
                if (ann.type === ToolType.TEXT) {
                    const hx = ann.start!.x + ann.textWidth!;
                    const hy = ann.start!.y + ann.textHeight!;
                    if (this.dist(x, y, hx, hy) < 15) return { annotation: ann, handle: 'resize' };
                }
            }

            // Check Bounding volumes
            if (ann.type === ToolType.ARROW) {
                if (this.distToSegmentSquared(x, y, ann.start!, ann.end!) < 100) return { annotation: ann };
            } else if (ann.type === ToolType.TEXT) {
                if (x >= ann.start!.x && x <= ann.start!.x + ann.textWidth! && y >= ann.start!.y && y <= ann.start!.y + ann.textHeight!) {
                    return { annotation: ann };
                }
            } else if (ann.type === ToolType.XMARK || ann.type === ToolType.QUESTION) {
                if (this.dist(x, y, ann.center!.x, ann.center!.y) < ann.size) return { annotation: ann };
            } else if (ann.type === ToolType.LINE || ann.type === ToolType.HIGHLIGHTER) {
                for (let j = 0; j < ann.points!.length - 1; j++) {
                    if (this.distToSegmentSquared(x, y, ann.points![j], ann.points![j + 1]) < 100) return { annotation: ann };
                }
            }
        }
        return null;
    }

    private moveAnnotation(ann: Annotation, dx: number, dy: number) {
        if (ann.type === ToolType.ARROW) {
            ann.start!.x += dx; ann.start!.y += dy;
            ann.end!.x += dx; ann.end!.y += dy;
        } else if (ann.type === ToolType.LINE || ann.type === ToolType.HIGHLIGHTER) {
            ann.points!.forEach(p => { p.x += dx; p.y += dy; });
        } else if (ann.type === ToolType.XMARK || ann.type === ToolType.QUESTION) {
            ann.center!.x += dx; ann.center!.y += dy;
        } else if (ann.type === ToolType.TEXT) {
            ann.start!.x += dx; ann.start!.y += dy;
        }
    }

    private handleMouseMove(e: MouseEvent) {
        this.mousePos = { x: e.clientX, y: e.clientY };

        if (!this.isLocked) {
            requestAnimationFrame(() => this.redraw());
            return;
        }

        if (this.draggingHandle !== 'none' && this.selectedAnnotation) {
            const dx = e.clientX - this.dragOffset.x;
            const dy = e.clientY - this.dragOffset.y;

            if (this.draggingHandle === 'move') {
                this.moveAnnotation(this.selectedAnnotation, dx, dy);
            } else if (this.draggingHandle === 'start') {
                this.selectedAnnotation.start!.x += dx;
                this.selectedAnnotation.start!.y += dy;
            } else if (this.draggingHandle === 'end') {
                this.selectedAnnotation.end!.x += dx;
                this.selectedAnnotation.end!.y += dy;
            } else if (this.draggingHandle === 'resize') {
                this.selectedAnnotation.textWidth! = Math.max(50, this.selectedAnnotation.textWidth! + dx);
                this.selectedAnnotation.textHeight! = Math.max(30, this.selectedAnnotation.textHeight! + dy);
            }
            this.dragOffset = { x: e.clientX, y: e.clientY };
            this.redraw();
            return;
        }

        if (this.isDrawing && this.currentAnnotation) {
            if (this.currentTool === ToolType.LINE || this.currentTool === ToolType.HIGHLIGHTER) {
                this.currentAnnotation.points!.push({ x: e.clientX, y: e.clientY });
            } else if (this.currentTool === ToolType.ARROW) {
                this.currentAnnotation.end = { x: e.clientX, y: e.clientY };
            }
            this.redraw();
        }
    }

    private handleMouseDown(e: MouseEvent) {
        if (!this.isLocked) {
            if (this.shape === 'custom-box') {
                if (!this.customBoxStart) {
                    this.customBoxStart = { x: e.clientX, y: e.clientY };
                    requestAnimationFrame(() => this.redraw());
                } else {
                    this.customBoxEnd = { x: e.clientX, y: e.clientY };
                    this.lockFocus();
                }
            }
            return;
        }

        // Check if editing text exists, close it forcefully on any outer click
        if (this.activeTextArea && e.target !== this.activeTextArea) {
            (this.activeTextArea as any).forceFinalize();
        }

        if (!this.currentTool) {
            const hit = this.getHitAnnotation(e.clientX, e.clientY);
            if (hit) {
                this.selectedAnnotation = hit.annotation;
                this.draggingHandle = hit.handle || 'move';
                this.dragOffset = { x: e.clientX, y: e.clientY };

                // If it's pure text hit and purely move, spawn text box back up!
                if (hit.annotation.type === ToolType.TEXT && this.draggingHandle === 'move') {
                    this.startTextTool(hit.annotation.start!.x, hit.annotation.start!.y, hit.annotation);
                }

                this.redraw();
                return;
            } else {
                this.selectedAnnotation = null;
                this.redraw();
                return;
            }
        }

        // Tool selected - begin drawing phase
        if (this.selectedAnnotation) {
            this.selectedAnnotation = null;
            this.redraw();
        }

        this.startPoint = { x: e.clientX, y: e.clientY };

        if (this.currentTool === ToolType.ARROW && this.isDrawing && this.currentAnnotation && this.currentAnnotation.type === ToolType.ARROW) {
            // Second click execution specifically for arrow click-and-click method
            this.currentAnnotation.end = { ...this.startPoint };
            this.finalizeAnnotation();
            this.isDrawing = false;
            return;
        }

        this.isDrawing = true;
        const id = Date.now().toString();

        if (this.currentTool === ToolType.LINE || this.currentTool === ToolType.HIGHLIGHTER) {
            this.currentAnnotation = {
                id, type: this.currentTool, color: this.currentColor, thickness: this.currentThickness, size: this.stampSize,
                points: [{ ...this.startPoint }]
            };
        } else if (this.currentTool === ToolType.ARROW) {
            this.currentAnnotation = {
                id, type: ToolType.ARROW, color: this.currentColor, thickness: this.currentThickness, size: this.stampSize,
                start: { ...this.startPoint }, end: { ...this.startPoint }
            };
        } else if (this.currentTool === ToolType.XMARK || this.currentTool === ToolType.QUESTION) {
            this.currentAnnotation = {
                id, type: this.currentTool, color: this.currentColor, thickness: this.currentThickness, size: this.stampSize,
                center: { ...this.startPoint }
            };
            this.finalizeAnnotation();
            this.isDrawing = false;
        } else if (this.currentTool === ToolType.TEXT) {
            this.startTextTool(e.clientX, e.clientY);
            this.isDrawing = false;
        }
    }

    private handleMouseUp(e: MouseEvent) {
        if (!this.isLocked) return;

        if (this.draggingHandle !== 'none') {
            this.draggingHandle = 'none';
            this.saveState();
            return;
        }

        if (this.isDrawing && this.currentAnnotation && this.currentTool) {
            if (this.currentTool === ToolType.ARROW) {
                if (this.startPoint!.x === e.clientX && this.startPoint!.y === e.clientY) {
                    // They just clicked and didn't drag. Keep letting them use mouse move to pull arrow, finish next click.
                    return;
                }
            }
            this.finalizeAnnotation();
        }
        this.isDrawing = false;
    }

    private finalizeAnnotation() {
        if (this.currentAnnotation) {
            this.saveState();
            this.annotations.push(this.currentAnnotation);
            const ann = this.currentAnnotation;
            this.currentAnnotation = null;
            this.redraw();

            if (ann.type !== ToolType.TEXT) {
                // Spawn auto-text UI completely tied near newly created shape
                let px = window.innerWidth / 2;
                let py = window.innerHeight / 2;
                if (ann.type === ToolType.ARROW) {
                    px = ann.end!.x + 20; py = ann.end!.y + 20;
                } else if (ann.center) {
                    px = ann.center.x + 20; py = ann.center.y + 20;
                } else if (ann.points) {
                    px = ann.points[ann.points.length - 1].x + 20; py = ann.points[ann.points.length - 1].y + 20;
                }
                setTimeout(() => this.startTextTool(px, py), 50); // Delay slightly so pointer events cleanup safely
            }
        }
    }

    private handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        if (!this.isLocked) {
            if (this.shape === 'custom-box' && this.customBoxStart) {
                this.customBoxStart = null;
                requestAnimationFrame(() => this.redraw());
            } else {
                this.lockFocus();
            }
        } else {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(['autonateDefaultAction'], (result: any) => {
                    const action = result.autonateDefaultAction || 'copy';
                    if (action === 'copy') this.copyToClipboard();
                    else this.exportCanvas();
                });
            } else {
                this.copyToClipboard();
            }
        }
    }

    private handleWheel(e: WheelEvent) {
        e.preventDefault();
        if (!this.isLocked) {
            if (this.shape === 'custom-box') return;
            const delta = Math.sign(e.deltaY) * -10;
            this.focusRadius = Math.max(25, Math.min(this.focusRadius + delta, 600));
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ autonateFocusRadius: this.focusRadius });
            }
            requestAnimationFrame(() => this.redraw());
        } else {
            const delta = Math.sign(e.deltaY) * -2;
            this.stampSize = Math.max(4, Math.min(this.stampSize + delta, 200));
            this.updateCursor();
        }
    }

    private handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            this.cleanup();
        } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            e.preventDefault();
            this.undo();
        } else if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
            e.preventDefault();
            this.redo();
        }
    }

    // --- UI Helpers ---
    private showToolPalette() {
        if (this.toolPalette) this.toolPalette.remove();
        this.toolPalette = document.createElement('div');

        let paletteX = 15;
        let paletteY = (window.innerHeight / 2) - (260 * this.paletteScale);

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

        const colorRow = document.createElement('div');
        colorRow.style.cssText = `display:flex; justify-content:center; padding-bottom:${Math.max(1, 4 * this.paletteScale)}px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:${Math.max(1, 2 * this.paletteScale)}px;`;
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.currentColor;
        colorInput.style.cssText = `width:${Math.max(16, 32 * this.paletteScale)}px; height:${Math.max(16, 32 * this.paletteScale)}px; cursor:pointer; border:none; padding:0; background:none; border-radius:${Math.max(3, 6 * this.paletteScale)}px;`;
        colorInput.onchange = (e) => {
            this.currentColor = (e.target as HTMLInputElement).value;
            if (this.selectedAnnotation) {
                this.saveState();
                this.selectedAnnotation.color = this.currentColor;
                this.redraw();
            }
            this.updateCursor();
        };
        colorRow.appendChild(colorInput);
        this.toolPalette.appendChild(colorRow);

        // Thickness Slider
        const thickRow = document.createElement('div');
        thickRow.style.cssText = `display:flex; flex-direction:column; padding-bottom:${Math.max(1, 4 * this.paletteScale)}px; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:${Math.max(1, 4 * this.paletteScale)}px; align-items:center; gap:2px;`;
        const thickLabel = document.createElement('span');
        thickLabel.textContent = 'Thickness';
        thickLabel.style.cssText = `color:white; font-size:${Math.max(8, 11 * this.paletteScale)}px; font-weight:bold;`;
        const thickSlider = document.createElement('input');
        thickSlider.type = 'range'; thickSlider.min = '1'; thickSlider.max = '20'; thickSlider.value = this.currentThickness.toString();
        thickSlider.style.cssText = `width:${Math.max(30, 44 * this.paletteScale)}px; margin: 0; padding: 0; cursor: pointer;`;
        thickSlider.oninput = (e) => {
            this.currentThickness = parseInt((e.target as HTMLInputElement).value);
            if (this.selectedAnnotation) {
                this.saveState();
                this.selectedAnnotation.thickness = this.currentThickness;
                this.redraw();
            }
            this.updateCursor();
        };
        thickRow.appendChild(thickLabel);
        thickRow.appendChild(thickSlider);
        this.toolPalette.appendChild(thickRow);

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
                display: flex; align-items: center; justify-content: center;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: ${Math.max(4, 10 * this.paletteScale)}px;
                background: rgba(30, 41, 59, 0.8); cursor: pointer; color: white;
            `;

            btn.onclick = () => {
                if (this.currentTool === tool) {
                    this.currentTool = null; // Toggle off
                } else {
                    this.currentTool = tool;
                }

                this.selectedAnnotation = null;
                this.isDrawing = false;
                this.updateCursor();
                this.redraw();

                this.toolPalette!.querySelectorAll('button[data-tool]').forEach((b) => {
                    const el = b as HTMLElement;
                    if (el.dataset.tool === this.currentTool) {
                        el.style.background = 'rgba(6, 182, 212, 0.3)';
                        el.style.borderColor = '#06b6d4';
                    } else {
                        el.style.background = 'rgba(30, 41, 59, 0.8)';
                        el.style.borderColor = 'rgba(255,255,255,0.1)';
                    }
                });
            };
            this.toolPalette!.appendChild(btn);
        });

        document.body.appendChild(this.toolPalette);
    }

    private updateCursor() {
        if (!this.isLocked) return;
        if (!this.currentTool) {
            this.canvas.style.cursor = 'default';
            return;
        }

        const size = this.stampSize;
        const color = this.currentColor;
        const viewBoxSize = size * 2 + 20;
        const center = viewBoxSize / 2;
        let svgContent = '';

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

    private startTextTool(x: number, y: number, existingModel?: Annotation) {
        if (this.activeTextArea) {
            (this.activeTextArea as any).forceFinalize();
        }

        const textArea = document.createElement('div');
        textArea.contentEditable = 'true';
        textArea.style.position = 'fixed';
        textArea.style.color = existingModel ? existingModel.color : this.currentColor;
        const fontSize = existingModel ? existingModel.size : this.stampSize;
        textArea.style.fontSize = `${fontSize}px`;
        textArea.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";
        textArea.style.backgroundColor = 'rgba(15, 23, 42, 0.4)';
        textArea.style.border = '1px dashed rgba(255, 255, 255, 0.5)';
        textArea.style.padding = '4px 8px';
        textArea.style.margin = '0';
        textArea.style.outline = 'none';
        textArea.style.resize = 'both';
        textArea.style.overflow = 'hidden';
        textArea.style.whiteSpace = 'pre-wrap';
        textArea.style.wordBreak = 'break-word';
        textArea.style.zIndex = '2147483647';

        textArea.style.left = `${x}px`;
        textArea.style.top = `${y}px`;

        if (existingModel) {
            textArea.innerText = existingModel.text || '';
            textArea.style.width = `${existingModel.textWidth}px`;
            textArea.style.height = `${existingModel.textHeight}px`;
        } else {
            textArea.style.minWidth = '50px';
            textArea.style.minHeight = `${fontSize + 10}px`;
        }

        textArea.style.maxWidth = `${window.innerWidth - x - 20}px`;
        textArea.style.maxHeight = `${window.innerHeight - y - 20}px`;
        textArea.style.pointerEvents = 'auto';

        this.canvas.style.pointerEvents = 'none';
        this.activeTextArea = textArea;

        const finalize = () => {
            if (!textArea.parentElement) return;
            const text = textArea.innerText;
            const rect = textArea.getBoundingClientRect();

            if (existingModel) {
                if (!text.trim()) {
                    // Delete
                    this.saveState();
                    this.annotations = this.annotations.filter(a => a.id !== existingModel.id);
                } else {
                    this.saveState();
                    existingModel.text = text;
                    existingModel.textWidth = rect.width;
                    existingModel.textHeight = Math.max(rect.height, textArea.scrollHeight);
                }
            } else if (text.trim()) {
                this.saveState();
                this.annotations.push({
                    id: Date.now().toString(),
                    type: ToolType.TEXT,
                    color: this.currentColor,
                    thickness: this.currentThickness,
                    size: fontSize,
                    start: { x: rect.left, y: rect.top },
                    text: text,
                    textWidth: rect.width,
                    textHeight: Math.max(rect.height, textArea.scrollHeight)
                });
            }

            textArea.remove();
            this.activeTextArea = null;
            this.canvas.style.pointerEvents = 'auto';
            this.redraw();
        };

        (textArea as any).forceFinalize = finalize;

        textArea.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finalize();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finalize();
            }
        });

        document.body.appendChild(textArea);
        setTimeout(() => {
            textArea.focus();
            if (existingModel) {
                const s = window.getSelection();
                const r = document.createRange();
                r.selectNodeContents(textArea);
                r.collapse(false);
                if (s) { s.removeAllRanges(); s.addRange(r); }
            }
        }, 10);

        this.redraw(); // Will hide the active canvas text natively
    }

    // --- Math Utils ---
    private dist(x1: number, y1: number, x2: number, y2: number) {
        return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
    }

    private distToSegmentSquared(px: number, py: number, v: Point, w: Point) {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return (px - v.x) ** 2 + (py - v.y) ** 2;
        let t = ((px - v.x) * (w.x - v.x) + (py - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (px - (v.x + t * (w.x - v.x))) ** 2 + (py - (v.y + t * (w.y - v.y))) ** 2;
    }

    // --- Export ---
    private async copyToClipboard() {
        if (this.activeTextArea) (this.activeTextArea as any).forceFinalize();
        try {
            this.selectedAnnotation = null;
            this.redraw();
            const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error("Canvas to Blob failed");
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch (err) { } finally { this.cleanup(); }
    }

    private exportCanvas() {
        if (this.activeTextArea) (this.activeTextArea as any).forceFinalize();
        this.selectedAnnotation = null;
        this.redraw();
        const link = document.createElement('a');
        link.download = `autonate-capture-${Date.now()}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
        this.cleanup();
    }

    private cleanup() {
        this.canvas.remove();
        if (this.toolPalette) this.toolPalette.remove();
        if (this.activeTextArea) this.activeTextArea.remove();
        (window as any).autonateInstance = null;
    }
}

// ----------------------------------------------------------------------
// COMMUNICATION WITH BACKGROUND.JS
// ----------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    if (request.action === "START_CAPTURE" && request.dataUrl) {
        if ((window as any).autonateInstance) {
            (window as any).autonateInstance.cleanup();
        }
        (window as any).autonateInstance = new AutonateController(request.dataUrl);
        sendResponse({ success: true });
    }
});