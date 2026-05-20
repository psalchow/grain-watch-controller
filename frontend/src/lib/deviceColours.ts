const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777'] as const;

const FIXED: Record<string, string> = {
  '1.1': '#2563eb',
  '1.2': '#16a34a',
  '1.3': '#d97706',
  '1.4': '#9333ea',
  '1.5': '#db2777',
};

export function getDeviceColour(device: string): string {
  const fixed = FIXED[device];
  if (fixed) return fixed;
  let hash = 0;
  for (let i = 0; i < device.length; i++) {
    hash = (hash * 31 + device.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}
