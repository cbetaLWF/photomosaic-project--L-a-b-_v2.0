// RGB -> L*a*b* 変換のためのヘルパー関数
// (D65ホワイトポイントを使用)
function rgbToLab(r, g, b) {
    // 0-255 RGB値を0-1の線形空間に変換 (ガンマ補正適用)
    let var_R = r / 255;
    let var_G = g / 255;
    let var_B = b / 255;

    // sRGBから線形RGBへの変換 (逆ガンマ補正)
    if (var_R > 0.04045) var_R = Math.pow(((var_R + 0.055) / 1.055), 2.4);
    else var_R = var_R / 12.92;
    if (var_G > 0.04045) var_G = Math.pow(((var_G + 0.055) / 1.055), 2.4);
    else var_G = var_G / 12.92;
    if (var_B > 0.04045) var_B = Math.pow(((var_B + 0.055) / 1.055), 2.4);
    else var_B = var_B / 12.92;

    // 0-1の値を0-100にスケール
    var_R = var_R * 100;
    var_G = var_G * 100;
    var_B = var_B * 100;

    // 線形RGBからXYZへの変換
    let X = var_R * 0.4124 + var_G * 0.3576 + var_B * 0.1805;
    let Y = var_R * 0.2126 + var_G * 0.7152 + var_B * 0.0722;
    let Z = var_R * 0.0193 + var_G * 0.1192 + var_B * 0.9505;

    // D65標準白色点
    let ref_X = 95.047; 
    let ref_Y = 100.000;
    let ref_Z = 108.883;

    let var_X = X / ref_X;
    let var_Y = Y / ref_Y;
    let var_Z = Z / ref_Z;

    // f(t)関数 (L*a*b*変換の非線形部分)
    const f = (t) => t > 0.008856 ? Math.pow(t, (1 / 3)) : (7.787 * t) + (16 / 116);

    var_X = f(var_X);
    var_Y = f(var_Y);
    var_Z = f(var_Z);

    // L*a*b*値の計算
    let L = (116 * var_Y) - 16;
    let a = 500 * (var_X - var_Y);
    let b_star = 200 * (var_Y - var_Z);
    
    // 値を丸めて精度を保つ
    return { 
        l: parseFloat(L.toFixed(4)), 
        a: parseFloat(a.toFixed(4)), 
        b_star: parseFloat(b_star.toFixed(4)) 
    };
}


// Workerで受け取った画像データ配列を処理
self.onmessage = async (e) => {
    // データの取得
    const { files } = e.data; 
    const results = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];

        if (!file.type.startsWith('image/')) {
            continue;
        }

        try {
            // 画像ファイルを読み込み、ImageBitmapを作成 (高速)
            const imageBitmap = await createImageBitmap(file);
            
            // OffscreenCanvasで画像を描画
            const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imageBitmap, 0, 0);

            // ピクセルデータ取得
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let r_sum = 0, g_sum = 0, b_sum = 0;
            const pixelCount = data.length / 4;

            // 4. 平均色を計算 (RGB)
            for (let j = 0; j < data.length; j += 4) {
                r_sum += data[j];
                g_sum += data[j + 1];
                b_sum += data[j + 2];
            }

            const r_avg = Math.round(r_sum / pixelCount);
            const g_avg = Math.round(g_sum / pixelCount);
            const b_avg = Math.round(b_sum / pixelCount);
            
            // 5. 平均RGBをL*a*b*に変換
            const lab = rgbToLab(r_avg, g_avg, b_avg);

            // --- 元のファイル名をそのまま利用 ---
            const fileName = file.name; 

            // 6. 結果を格納 (L*a*b*をメインのマッチングデータとして使用)
            results.push({
                // Mosaic Appの/tilesフォルダを基準とした相対パス
                url: `tiles/${fileName}`, 
                r: r_avg, // RGBもデバッグ用に保持
                g: g_avg,
                b: b_avg,
                l: lab.l, // ★L*a*b*値を保存
                a: lab.a,
                b_star: lab.b_star
            });
            
            // 7. 進捗をメインスレッドに通知
            self.postMessage({ 
                type: 'progress', 
                progress: (i + 1) / totalFiles, 
                fileName: fileName 
            });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    // 全処理完了を通知し、結果データを渡す
    self.postMessage({ type: 'complete', results: results });
};
