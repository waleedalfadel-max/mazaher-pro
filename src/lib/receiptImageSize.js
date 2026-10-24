// Preserve long receipts equally in portrait and landscape. Never enlarge, never crop.
export function receiptImageSize(width,height,shortEdge=1400,longEdge=6000) {
  if (!(width>0&&height>0&&Number.isFinite(width)&&Number.isFinite(height))) throw new Error('invalid_image_size')
  const scale=Math.min(1,shortEdge/Math.min(width,height),longEdge/Math.max(width,height))
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))}
}
