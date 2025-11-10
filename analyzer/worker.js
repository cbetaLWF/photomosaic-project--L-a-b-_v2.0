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

    // L*は0-100の範囲に、a*b*は約-100から+100の範囲になるようにクランプ
    l = Math.max(0, Math.min(100, l));

    return { l: l, a: a, b_star: b_star };
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
            // 画像ファイルを読み込み
            const imageBitmap = await createImageBitmap(file);
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            // ピクセルデータ取得
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let r_sum = 0, g_sum = 0, b_sum = 0;
            const pixelCount = data.length / 4;

            // 平均色を計算
            for (let j = 0; j < data.length; j += 4) {
                r_sum += data[j];
                g_sum += data[j + 1];
                b_sum += data[j + 2];
            }

            const r = Math.round(r_sum / pixelCount);
            const g = Math.round(g_sum / pixelCount);
            const b = Math.round(b_sum / pixelCount);

            // RGB平均からL*a*b*へ変換
            const lab = rgbToLab(r, g, b);

            // 結果を格納
            results.push({
                // アップロードされた元のファイル名をそのまま使用
                url: `tiles/${file.name}`, 
                r: r,
                g: g,
                b: b,
                l: lab.l,
                a: lab.a,
                b_star: lab.b_star
            });
            
            // 進捗をメインスレッドに通知
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    // 全処理完了を通知し、結果データを渡す
    self.postMessage({ type: 'complete', results: results });
};
