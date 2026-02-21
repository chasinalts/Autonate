export enum ShapeType {
  CIRCLE = 'circle',
  SQUARE = 'square',
  RECTANGLE = 'rectangle'
}

export interface AppState {
  shape: ShapeType;
  blur: number;
}

declare global {
  var chrome: any;
}