export function fitA4Content(root: HTMLElement, content: HTMLElement): () => void {
  const original = {
    width: content.style.width,
    transform: content.style.transform,
    transformOrigin: content.style.transformOrigin,
  };
  const rootStyle = getComputedStyle(root);
  const pagePadding = (Number.parseFloat(rootStyle.paddingTop) || 0)
    + (Number.parseFloat(rootStyle.paddingBottom) || 0);
  const availableHeight = Math.max(0, root.clientHeight - pagePadding);
  const contentHeight = content.scrollHeight;
  if (availableHeight > 0 && contentHeight > availableHeight) {
    const scale = availableHeight / contentHeight;
    content.style.width = `calc(100% / ${scale})`;
    content.style.transformOrigin = 'top left';
    content.style.transform = `scale(${scale})`;
  }

  return () => {
    content.style.width = original.width;
    content.style.transform = original.transform;
    content.style.transformOrigin = original.transformOrigin;
  };
}
