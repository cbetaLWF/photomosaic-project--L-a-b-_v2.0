// L*a*b*変換のための定数とヘルパー関数
const REF_X = 95.047; // D65
const REF_Y = 100.000;
const REF_Z = 108.883;

function f(t) {
    return t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + (16 / 116);
}

function rgbToLab(r, g, b) {
    // 1. RGB to XYZ
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100;
    // 2. XYZ to L*a*b*
    let fx = f(x / REF_X); let fy = f(y / REF_Y); let fz = f(z / REF_Z);
    let l = (116 * fy) - 16; let a = 500 * (fx - fy); let b_star = 200 * (fy - fz);
    l = Math.max(0, Math.min(100, l));
    return { l: l, a: a, b_star: b_star };
}

// 平均RGBからL*値のみを返す簡易ヘルパー
function getLstar(r, g, b) {
    return rgbToLab(r, g, b).l;
}

// ★ 修正: 1枚の画像をリサイズし、ImageBitmapとして返す
async function resizeImage(imageBitmap, targetWidth, targetHeight) {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(imageBitmap, 
        0, 0, imageBitmap.width, imageBitmap.height, // ソース (元画像)
        0, 0, targetWidth, targetHeight              // 描画先 (リサイズ)
    );
    // Bitmapを返す (Blob化しない)
    return canvas.transferToImageBitmap();
}


// ★ 修正: L*a*b*解析ロジック (リサイズされたBitmap (例: 160x90) を入力とする)
async function analyzeImagePatterns(imageBitmap) { // (例: 160x90)
    const patterns = [];

    const baseWidth = imageBitmap.width;
    const baseHeight = imageBitmap.height;
    
    // 1. クロップ設定 (短辺に合わせた正方形)
    const sSize = Math.min(baseWidth, baseHeight); // (例: 90)
    const isHorizontal = baseWidth > baseHeight; 

    const cropSettings = isHorizontal ? [
        { name: "cropL", x: 0, y: 0, sSize: sSize },
        { name: "cropC", x: Math.floor((baseWidth - sSize) / 2), y: 0, sSize: sSize },
        { name: "cropR", x: baseWidth - sSize, y: 0, sSize: sSize }
    ] : [
        { name: "cropT", x: 0, y: 0, sSize: sSize }, 
        { name: "cropM", x: 0, y: Math.floor((baseHeight - sSize) / 2), sSize: sSize },
        { name: "cropB", x: 0, y: baseHeight - sSize, sSize: sSize }
    ];

    // 2. 反転設定
    const flipSettings = [
        { name: "flip0", flip: false }, // 通常
        { name: "flip1", flip: true }  // 水平反転
    ];

    // 3x3 L*ベクトル計算用の境界 (正方形なので共通)
    const oneThird = Math.floor(sSize / 3);
    const twoThirds = Math.floor(sSize * 2 / 3);
    
    // 一時描画用のOffscreenCanvas (L*ベクトル解析用)
    const analysisCanvas = new OffscreenCanvas(sSize, sSize);
    const ctx = analysisCanvas.getContext('2d');

    // --- 3 (クロップ) x 2 (反転) = 6 パターンのループ ---
    for (const crop of cropSettings) {
        for (const flip of flipSettings) {
            
            // --- 描画フェーズ ---
            ctx.clearRect(0, 0, sSize, sSize);
            if (flip.flip) {
                ctx.save();
                ctx.scale(-1, 1); // 左右反転
                ctx.drawImage(imageBitmap, crop.x, crop.y, sSize, sSize, -sSize, 0, sSize, sSize);
                ctx.restore();
            } else {
                ctx.drawImage(imageBitmap, crop.x, crop.y, sSize, sSize, 0, 0, sSize, sSize);
            }
            
            // --- 解析フェーズ ---
            const imageData = ctx.getImageData(0, 0, sSize, sSize);
            // ( ... 3x3 L*ベクトル計算 ... )
            const data = imageData.data;
            const sums = Array(9).fill(null).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
            let r_sum_total = 0, g_sum_total = 0, b_sum_total = 0;
            const pixelCountTotal = data.length / 4;
            for (let y = 0; y < sSize; y++) {
                const row = (y < oneThird) ? 0 : (y < twoThirds ? 1 : 2);
                for (let x = 0; x < sSize; x++) {
                    const idx = (y * sSize + x) * 4;
                    const r = data[idx], g = data[idx+1], b = data[idx+2];
                    r_sum_total += r; g_sum_total += g; b_sum_total += b;
                    const col = (x < oneThird) ? 0 : (x < twoThirds ? 1 : 2);
                    const gridIndex = row * 3 + col;
                    sums[gridIndex].r += r; sums[gridIndex].g += g; sums[gridIndex].b += b;
                    sums[gridIndex].count++;
                }
            }
            const r_avg = r_sum_total / pixelCountTotal;
            const g_avg = g_sum_total / pixelCountTotal;
            const b_avg = b_sum_total / pixelCountTotal;
            const lab = rgbToLab(r_avg, g_avg, b_avg);
            const l_vector = sums.map(s => {
                if (s.count === 0) return 0;
                return getLstar(s.r / s.count, s.g / s.count, s.b / s.count);
            });

            patterns.push({
                type: `${crop.name}_${flip.name}`, 
                l: lab.l, a: lab.a, b_star: lab.b_star,
                l_vector: l_vector
            });
        }
    }
    // L*パターン(6種)を返す
    return patterns;
}


// ★★★ メイン処理: スプライトシート戦略 ★★★
self.onmessage = async (e) => {
    // thumbnailSize (F2) は 160x90 の幅(160)として流用
    const { files, thumbnailQuality, thumbnailSize } = e.data; 
    
    // 0. スプライトシート定義
    // ★★★ 修正点: F2/F3の解像度を 1/4 に削減 ★★★
    const F2_WIDTH = 160;
    const F2_HEIGHT = 90;
    const F3_WIDTH = 640;
    const F3_HEIGHT = 360;
    // ★★★ 修正点ここまで ★★★
    
    const MAX_SHEET_WIDTH = 4096; // 4Kテクスチャ上限 (安全マージン)

    // F2 (Thumb) スプライトシートの計算 (500枚)
    const F2_COLS = Math.floor(MAX_SHEET_WIDTH / F2_WIDTH); // 4096 / 160 = 25
    const F2_ROWS = Math.ceil(files.length / F2_COLS);    // 500 / 25 = 20
    const F2_SHEET_WIDTH = F2_COLS * F2_WIDTH;             // 25 * 160 = 4000
    const F2_SHEET_HEIGHT = F2_ROWS * F2_HEIGHT;           // 20 * 90 = 1800
    
    // F3 (Full) スプライトシートの計算 (500枚)
    const F3_COLS = Math.floor(MAX_SHEET_WIDTH / F3_WIDTH); // 4096 / 640 = 6
    const F3_ROWS_PER_SHEET = Math.floor(MAX_SHEET_WIDTH / F3_HEIGHT); // 4096 / 360 = 11
    const F3_TILES_PER_SHEET = F3_COLS * F3_ROWS_PER_SHEET; // 6 * 11 = 66
    const F3_SHEET_COUNT = Math.ceil(files.length / F3_TILES_PER_SHEET); // 500 / 66 = 8
    const F3_SHEET_WIDTH = F3_COLS * F3_WIDTH;             // 6 * 640 = 3840
    const F3_SHEET_HEIGHT = F3_ROWS_PER_SHEET * F3_HEIGHT;   // 11 * 360 = 3960

    // 1. JSONデータ構造の初期化
    const jsonOutput = {
        tileSets: {
            thumb: {
                sheetUrl: "sprites/thumb_sheet.jpg",
                tileWidth: F2_WIDTH,
                tileHeight: F2_HEIGHT
            },
            full: {
                sheetUrls: [],
                tileWidth: F3_WIDTH,
                tileHeight: F3_HEIGHT
            }
        },
        tiles: []
    };
    
    // 2. スプライトシート用Canvasの準備
    const f2_canvas = new OffscreenCanvas(F2_SHEET_WIDTH, F2_SHEET_HEIGHT);
    const f2_ctx = f2_canvas.getContext('2d');
    
    const f3_canvases = [];
    for (let i = 0; i < F3_SHEET_COUNT; i++) {
        // 最後のシートの高さを調整 (500枚ぴったりにするため)
        let sheetHeight = F3_SHEET_HEIGHT;
        if (i === F3_SHEET_COUNT - 1) {
            const tilesLeft = files.length - (i * F3_TILES_PER_SHEET);
            const rowsLeft = Math.ceil(tilesLeft / F3_COLS);
            sheetHeight = rowsLeft * F3_HEIGHT;
        }
        const canvas = new OffscreenCanvas(F3_SHEET_WIDTH, sheetHeight);
        f3_canvases.push(canvas);
        jsonOutput.tileSets.full.sheetUrls.push(`sprites/full_sheet_${i}.jpg`);
    }

    const totalFiles = files.length;

    // 3. 全ファイルループ (解析とスプライトシート描画)
    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;

        try {
            const originalBitmap = await createImageBitmap(file);

            // --- F2/F1処理 ---
            // F2用 (160x90) にリサイズ
            const f2_bitmap = await resizeImage(originalBitmap, F2_WIDTH, F2_HEIGHT);
            
            // F1用 (L*ベクトル解析)
            const patterns = await analyzeImagePatterns(f2_bitmap);
            
            // F2スプライトシートに描画
            const f2_x = (i % F2_COLS) * F2_WIDTH;
            const f2_y = Math.floor(i / F2_COLS) * F2_HEIGHT;
            f2_ctx.drawImage(f2_bitmap, f2_x, f2_y);

            // --- F3処理 ---
            // F3用 (640x360) にリサイズ
            const f3_bitmap = await resizeImage(originalBitmap, F3_WIDTH, F3_HEIGHT);
            
            // F3スプライトシートに描画
            const f3_sheetIndex = Math.floor(i / F3_TILES_PER_SHEET);
            const i_in_sheet = i % F3_TILES_PER_SHEET;
            const f3_x = (i_in_sheet % F3_COLS) * F3_WIDTH;
            const f3_y = Math.floor(i_in_sheet / F3_COLS) * F3_HEIGHT;
            
            f3_canvases[f3_sheetIndex].getContext('2d').drawImage(f3_bitmap, f3_x, f3_y);

            // --- JSONデータ作成 ---
            jsonOutput.tiles.push({
                id: i,
                patterns: patterns,
                thumbCoords: {
                    sheetIndex: 0,
                    x: f2_x,
                    y: f2_y
                },
                fullCoords: {
                    sheetIndex: f3_sheetIndex,
                    x: f3_x,
                    y: f3_y
                }
            });
            
            // メモリ解放
            originalBitmap.close();
            f2_bitmap.close();
            f3_bitmap.close();
            
            self.postMessage({ type: 'progress', progress: (i + 1) / totalFiles, fileName: file.name });

        } catch (error) {
            self.postMessage({ type: 'error', message: `解析エラー (${file.name}): ${error.message}` });
        }
    }

    // 4. スプライトシートをBlobに変換
    const spriteSheetBlobs = [];
    const jpegQuality = thumbnailQuality; // サムネイル品質を流用

    // F2 (Thumb)
    const f2_blob = await f2_canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality });
    spriteSheetBlobs.push({
        path: jsonOutput.tileSets.thumb.sheetUrl,
        blob: f2_blob
    });

    // F3 (Full)
    for (let i = 0; i < f3_canvases.length; i++) {
        const f3_blob = await f3_canvases[i].convertToBlob({ type: "image/jpeg", quality: jpegQuality });
        spriteSheetBlobs.push({
            path: jsonOutput.tileSets.full.sheetUrls[i],
            blob: f3_blob
        });
    }

    // 5. メインスレッドにJSONとBlob配列を送信
    self.postMessage({ 
        type: 'complete', 
        results: {
            json: jsonOutput,
            spriteSheets: spriteSheetBlobs
        } 
    });
};
