export enum ShapeType {
  CIRCLE = 'circle',
  SQUARE = 'square',
  RECTANGLE = 'rectangle',
  CUSTOM_BOX = 'custom-box'
}

export interface AppState {
  shape: ShapeType;
  blur: number;
}

declare global {
  var chrome: any;
}