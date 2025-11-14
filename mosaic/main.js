// ★ 変更点: 線画抽出（Sobel）を「複数閾値」で評価するように変更
function applySobelFilter(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    
    // 1. グレースケールに変換
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        // 知覚輝度 (Luma)
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }

    // 最終描画用の線画データ (透明で初期化)
    const finalSobelData = new Uint8ClampedArray(data.length);
    
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1]
    ];
    
    // ★ 変更点: 3段階の閾値
    const thresholds = {
        low: 15,  // 弱いディテール（質感）
        med: 30,  // 最終描画用の線画
        high: 80  // 強い輪郭（アニメ線など）
    };
    
    // ★ 変更点: 3段階のディテール量を格納するベクトル
    const detailVector = { low: 0, med: 0, high: 0 };

    // 2. Sobelフィルタ適用 (1回のループで全て計算)
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    const gray = grayscaleData[idx];
                    sumX += gray * Gx[ky + 1][kx + 1];
                    sumY += gray * Gy[ky + 1][kx + 1];
                }
            }

            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;

            // 1. 最終描画用の線画データ (med threshold)
            if (magnitude > thresholds.med) {
                const alpha = Math.min(255, magnitude * 1.5);
                finalSobelData[i] = 0;     // R (黒)
                finalSobelData[i + 1] = 0; // G (黒)
                finalSobelData[i + 2] = 0; // B (黒)
                finalSobelData[i + 3] = alpha; // A (不透明度)
                
                detailVector.med += alpha; // 中ディテール量
            }
            
            // 2. 賢い評価用の特徴ベクトル
            // (magnitude自体を加算することで、弱い線と強い線の差を明確にする)
            if (magnitude > thresholds.low) {
                detailVector.low += magnitude; 
            }
            if (magnitude > thresholds.high) {
                detailVector.high += magnitude;
            }
        }
    }
    
    // ★ 変更点: 最終的な線画ImageDataと、ディテールベクトルを返す
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector // ★ バグ修正: sumAlphaではなくdetailVectorを返す
    };
}
// ★ ヘルパー関数ここまで


// ★ 修正: fixedAnalyzeImageAndGetRecommendations を
// 正しい analyzeImageAndGetRecommendations にリネーム
function analyzeImageAndGetRecommendations(image, analysisImageData) {
    const width = image.width;
    const height = image.height;
    const data = analysisImageData.data; 
    
    let sumLuma = 0;
    for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sumLuma += luma;
    }
    const pixelCount = data.length / 4;
    const meanLuma = sumLuma / pixelCount; 
    
    // applySobelFilterは { finalEdgeImageData, detailVector } を返す
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; // ★ バグ修正: これで正しく取得できる
    
    // 0除算を避ける
    const detailLow = (detailVector.low / pixelCount) || 0;   
    const detailHigh = (detailVector.high / pixelCount) || 0; 
    
    const recommendations = {};
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;
    recommendations.brightnessCompensation = 100;
    recommendations.textureWeight = Math.round(Math.min(200, detailLow * 3.0 + 30)); 
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); 
    recommendations.edgeOpacity = Math.round(Math.max(10, 60 - detailHigh * 10.0));
    
    // 推奨値だけを返す
    return recommendations;
}
// ★ ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // ( ... UI要素の取得 ... )
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
// ... (既存のコード) ...
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');

    
    // ( ... 必須要素チェック ... )
    if (!mainCanvas || !statusText || !generateButton || !blendRangeInput || !edgeOpacityInput || !recommendationArea) {
        console.error("Initialization Error: One or more required HTML elements are missing.");
// ... (既存のコード) ...
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
// ... (既存のコード) ...
    let edgeCanvas = null; 
    let currentRecommendations = null;

    // ★ 変更点: キャッシュ機能のための変数
    let cachedResults = null; // Workerの計算結果（配置図）を保存
    let lastHeavyParams = {}; // 最後に実行した「重い」パラメータを保存
    // ★ 変更点ここまで


    // ( ... UIの初期設定 (スライダーリスナー含む) ... )
// ... (既存のコード) ...

    // --- 1. タイルデータの初期ロード ---
// ... (既存のコード) ...
    
    // --- 2. メイン画像アップロード ---
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
// ... (既存のコード) ...
            reader.onload = (event) => {
                mainImage = new Image();
                mainImage.onload = () => {
                    // ★ 変更点: 新しい画像がロードされたらキャッシュを破棄
                    cachedResults = null;
// ... (既存のコード) ...
                    ctx.drawImage(mainImage, 0, 0); // プレビュー表示
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    try {
                        // ( ... 推奨値の計算と表示 ... )
                        const analysisSize = 400; 
// ... (既存のコード) ...
                        analysisCtx.drawImage(mainImage, 0, 0, w, h);
                        const analysisImageData = analysisCtx.getImageData(0, 0, w, h);
                        
                        // ★ 修正: 正しい関数名を呼び出す (fixed... ではない)
                        const recommendations = analyzeImageAndGetRecommendations(mainImage, analysisImageData);
                        
                        currentRecommendations = recommendations; 
                        
                        // ★ 変更点: 線画の事前計算 (重複実行の解消)
                        statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                        const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                        const fullEdgeResult = applySobelFilter(fullImageData);
                        edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                        edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                        
                        // ( ... 推奨値エリアのテキストを更新 ... )
                        recTileSize.textContent = recommendations.tileSize;
// ... (既存のコード) ...
                        recEdgeOpacity.textContent = recommendations.edgeOpacity;
                        
                        recommendationArea.style.display = 'block';
// ... (既存のコード) ...

                    } catch (err) {
                        console.error("Recommendation analysis failed:", err);
// ... (既存のコード) ...
                    }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 「推奨値を適用」ボタンのリスナー
// ... (既存のコード) ...


    // 起動中の全Workerを強制終了するヘルパー関数
// ... (既存のコード) ...

    // --- 3. モザイク生成開始 (★ キャッシュ機能を追加) ---
    generateButton.addEventListener('click', () => {
// ... (既存のコード) ...
        
        // --- Case 1: 高速再描画 (Worker処理をスキップ) ---
// ... (既存のコード) ...
            return; // ★ Worker処理に進まずここで終了
        }
        
        // --- Case 2: 通常処理 (Worker処理を実行) ---
// ... (既存のコード) ...
        // (線画抽出はアップロード時に終わっているので不要)
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);

// ... (既存のコード) ...
        
        for (let i = 0; i < numWorkers; i++) {
// ... (既存のコード) ...
            worker.onmessage = (e) => {
                if (e.data.type === 'status') {
// ... (既存のコード) ...
                } else if (e.data.type === 'progress') {
// ... (既存のコード) ...
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    if (finishedWorkers === activeWorkers) {
// ... (既存のコード) ...
                        
                        // ★ 変更点: 結果をキャッシュに保存
                        cachedResults = allResults; 
                        
                        renderMosaic(
// ... (既存のコード) ...
                        );
                        terminateWorkers();
                    }
                }
            };
            worker.onerror = (error) => {
// ... (既存のコード) ...
            };
            worker.postMessage({ 
                imageData: imageData, 
// ... (既存のコード) ...
            });
            startY += chunkHeight;
        }
// ... (既存のコード) ...
    });

    // --- 4. 最終的なモザイクの描画 ---
// ... (既存のコード) ...

    // --- 5. ダウンロード機能 (PNG形式) ---
// ... (既存のコード) ...
});
