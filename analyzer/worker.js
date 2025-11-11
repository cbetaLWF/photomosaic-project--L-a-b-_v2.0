// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}

function rgbToLab(r, g, b) {
    // 1. RGB to XYZ
    r /= 255;
    g /= 255;
    b /= 255;

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;

    // 2. XYZ to L*a*b*
    let fx = f(x / REF_X);
    let fy = f(y / REF_Y);
    let fz = f(z / REF_Z);

    let l = (116 * fy) - 16;
    let a = 500 * (fx - fy);
    let b_star = 200 * (fy - fz);

    l = Math.max(0, Math.min(100, l));

    return { l: l, a: a, b_star: b_star };
}

// ★ 変更点: 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}

// Workerで受け取った画像データ配列を処理
self.onmessage = async (e) => {
    const { files } = e.data;
    const results = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];

        if (!file.type.startsWith('image/')) {
            continue;
        }

        try {
            const imageBitmap = await createImageBitmap(file);
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // --- ★ 変更点: 2x2 L*ベクトル計算のための準備 ---
            const width = canvas.width;
            const height = canvas.height;
            const midX = Math.floor(width / 2);
            const midY = Math.floor(height / 2);

            // [0]=TL, [1]=TR, [2]=BL, [3]=BR
            const sums = [
                { r: 0, g: 0, b: 0, count: 0 }, // Top-Left
                { r: 0, g: 0, b: 0, count: 0 }, // Top-Right
                { r: 0, g: 0, b: 0, count: 0 }, // Bottom-Left
                { r: 0, g: 0, b: 0, count: 0 }  // Bottom-Right
            ];
            
            // 全体の平均色計算用
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            const pixelCountTotal = data.length / 4;

            // ピクセルを走査
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];

                    // 1. 全体の平均色
                    r_sum_total += r;
                    g_sum_total += g;
                    b_sum_total += b;

                    // 2. ★ 変更点: どの領域(Quadrant)に属するか判定し、加算
                    let quadIndex;
                    if (y < midY) {
                        quadIndex = (x < midX) ? 0 : 1; // Top
                    } else {
                        quadIndex = (x < midX) ? 2 : 3; // Bottom
                    }
                    sums[quadIndex].r += r;
                    sums[quadIndex].g += g;
                    sums[quadIndex].b += b;
                    sums[quadIndex].count++;
                }
            }

            // --- 全体の平均色とL*a*b*を計算 ---
            const r_avg_total = r_sum_total / pixelCountTotal;
            const g_avg_total = g_sum_total / pixelCountTotal;
            const b_avg_total = b_sum_total / pixelCountTotal;
            const lab_total = rgbToLab(r_avg_total, g_avg_total, b_avg_total);

            // --- ★ 変更点: 4領域のL*ベクトルを計算 ---
            const l_vector = sums.map(s => {
                if (s.count === 0) return 0; // 空の領域は黒(L*=0)とする
                const r_avg = s.r / s.count;
                const g_avg = s.g / s.count;
                const b_avg = s.b / s.count;
                return getLstar(r_avg, g_avg, b_avg); // L*値のみを取得
            });

            // 結果を格納
            results.push({
                url: `tiles/${file.name}`, 
                r: Math.round(r_avg_total),
                g: Math.round(g_avg_total),
                b: Math.round(b_avg_total),
                l: lab_total.l,
                a: lab_total.a,
                b_star: lab_total.b_star,
                // ★ 変更点: histogram の代わりに l_vector を保存
                l_vector: l_vector // [l_tl, l_tr, l_bl, l_br]
            });
            
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    self.postMessage({ type: 'complete', results: results });
};
