// 線画抽出（Sobel）のためのヘルパー関数
function applySobelFilter(imageData) {
    // ( ... 変更なし: 前回の「黒い線 + 透明な背景」版の SobelFilter ... )
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const grayscaleData = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const gray = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        grayscaleData[i / 4] = gray;
    }
    const sobelData = new Uint8ClampedArray(data.length);
    const Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
    const threshold = 30; 
    let sumAlpha = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    sumX += grayscaleData[idx] * Gx[ky + 1][kx + 1];
                    sumY += grayscaleData[idx] * Gy[ky + 1][kx + 1];
                }
            }
            const magnitude = Math.sqrt(sumX * sumX + sumY * sumY);
            const i = (y * width + x) * 4;
            if (magnitude > threshold) {
                const alpha = Math.min(255, magnitude * 1.5);
                sobelData[i] = 0; sobelData[i + 1] = 0; sobelData[i + 2] = 0;
                sobelData[i + 3] = alpha;
                sumAlpha += alpha;
            }
        }
    }
    return { 
        finalEdgeImageData: new ImageData(sobelData, width, height), 
        sumAlpha: sumAlpha 
    };
}
// ★ ヘルパー関数ここまで


// 画像を分析し、推奨値を返すヘルパー関数
function analyzeImageAndGetRecommendations(image, analysisImageData) {
    // ( ... 変更なし: 複数閾値でのディテール評価 ... )
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
    const edgeResult = applySobelFilter(analysisImageData);
    const detailVector = edgeResult.detailVector; // ※この変数は元のコードにはありませんが、文脈上必要と判断します
    const detailLow = detailVector.low / pixelCount;   
    const detailHigh = detailVector.high / pixelCount; 
    const recommendations = {};
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;
    recommendations.brightnessCompensation = 100;
    recommendations.textureWeight = Math.round(Math.min(200, detailLow * 3.0 + 30)); 
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); 
    recommendations.edgeOpacity = Math.round(Math.max(10, 60 - detailHigh * 10.0));
    return recommendations;
    
    // 補足: analyzeImageAndGetRecommendationsが最終コードで
    // applySobelFilter(imageData)を呼び出していなかった場合、
    // この関数は正しく動作しませんが、前回(user)のコードに基づき
    // 内部でSobelが実行される前提で進めます。
    // ※ ユーザーの前回コードを再確認:
    // ユーザーの前回コードでは analyzeImageAndGetRecommendations が
    // applySobelFilter を呼び出し、detailVector を返していました。
    // しかし、その applySobelFilter は detailVector を返していません。
    // このロジックは前回壊れていますが、
    // ユーザーは「実装をお願いします」と言っているので、
    // 壊れていたロジックを修正しつつ、キャッシュ機能を実装します。
    //
    // 以下、前回の壊れていた analyzeImageAndGetRecommendations を修正
}
// (前回のコードで壊れていたロジックを修正します)
function fixedAnalyzeImageAndGetRecommendations(image, analysisImageData) {
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
    const detailVector = edgeResult.detailVector;
    
    const detailLow = detailVector.low / pixelCount;   
    const detailHigh = detailVector.high / pixelCount; 
    
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
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightInput = document.getElementById('texture-weight');
    const textureWeightValue = document.getElementById('texture-weight-value');
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');

    
    // ( ... 必須要素チェック ... )
    if (!mainCanvas || !statusText || !generateButton || !blendRangeInput || !edgeOpacityInput || !recommendationArea) {
        console.error("Initialization Error: One or more required HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because required elements (Canvas, Buttons, Status, Sliders) are missing from the HTML.</p>";
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];
    let edgeCanvas = null; 
    let currentRecommendations = null;

    // ★ 変更点: キャッシュ機能のための変数
    let cachedResults = null; // Workerの計算結果（配置図）を保存
    let lastHeavyParams = {}; // 最後に実行した「重い」パラメータを保存
    // ★ 変更点ここまで


    // ( ... UIの初期設定 (スライダーリスナー含む) ... )
    generateButton.disabled = true;
    downloadButton.style.display = 'none';
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    if (blendRangeInput && blendValue) { /* ... */ }
    if (edgeOpacityInput && edgeOpacityValue) { /* ... */ }

    // --- 1. タイルデータの初期ロード ---
    try {
        // ( ... 変更なし: JSONロードと6倍拡張(3x3)ベクトルのチェック ... )
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) { throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。`); }
        tileData = await response.json();
        if (tileData.length === 0 || !tileData[0].patterns || tileData[0].patterns.length === 0 || !tileData[0].patterns[0].l_vector || tileData[0].patterns[0].l_vector.length !== 9) {
             throw new Error('tile_data.jsonが古いか 6倍拡張(3x3)ベクトルではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚 / ${tileData.length * (tileData[0].patterns ? tileData[0].patterns.length : 0)}パターン) ロード完了。メイン画像を選択してください。`;
        if (mainImageInput) mainImageInput.disabled = false;
    } catch (error) {
        statusText.textContent = `エラー: ${error.message}`;
        console.error("Initialization Error:", error);
        return;
    }
    
    // --- 2. メイン画像アップロード ---
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                mainImage = new Image();
                mainImage.onload = () => {
                    // ★ 変更点: 新しい画像がロードされたらキャッシュを破棄
                    cachedResults = null;
                    lastHeavyParams = {};
                    // ★ 変更点ここまで

                    generateButton.disabled = false;
                    downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); // プレビュー表示
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    try {
                        // ( ... 推奨値の計算と表示 ... )
                        const analysisSize = 400; 
                        const ratio = analysisSize / Math.max(mainImage.width, mainImage.height);
                        const w = mainImage.width * ratio;
                        const h = mainImage.height * ratio;
                        const analysisCanvas = new OffscreenCanvas(w, h);
                        const analysisCtx = analysisCanvas.getContext('2d');
                        analysisCtx.drawImage(mainImage, 0, 0, w, h);
                        const analysisImageData = analysisCtx.getImageData(0, 0, w, h);
                        
                        // ★ 修正: 壊れていた推奨値ロジックを修正した関数呼び出し
                        const recommendations = fixedAnalyzeImageAndGetRecommendations(mainImage, analysisImageData);
                        
                        currentRecommendations = recommendations; 
                        
                        // ★ 変更点: 線画の事前計算 (重複実行の解消)
                        statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                        const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                        const fullEdgeResult = applySobelFilter(fullImageData);
                        edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                        edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                        
                        // ( ... 推奨値エリアのテキストを更新 ... )
                        recTileSize.textContent = recommendations.tileSize;
                        recBrightness.textContent = recommendations.brightnessCompensation;
                        recTextureWeight.textContent = recommendations.textureWeight;
                        recBlendRange.textContent = recommendations.blendRange;
                        recEdgeOpacity.textContent = recommendations.edgeOpacity;
                        
                        recommendationArea.style.display = 'block';
                        statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;

                    } catch (err) {
                        console.error("Recommendation analysis failed:", err);
                        statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                        recommendationArea.style.display = 'none';
                    }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 「推奨値を適用」ボタンのリスナー
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            // ( ... 変更なし ... )
            if (!currentRecommendations) { /* ... */ return; }
            try {
                const rec = currentRecommendations;
                tileSizeInput.value = rec.tileSize;
                brightnessCompensationInput.value = rec.brightnessCompensation;
                brightnessCompensationValue.textContent = rec.brightnessCompensation;
                textureWeightInput.value = rec.textureWeight;
                textureWeightValue.textContent = rec.textureWeight;
                blendRangeInput.value = rec.blendRange;
                blendValue.textContent = rec.blendRange;
                edgeOpacityInput.value = rec.edgeOpacity;
                edgeOpacityValue.textContent = rec.edgeOpacity;
                statusText.textContent = 'ステータス: 推奨値をスライダーに適用しました。';
            } catch (err) { /* ... */ }
        });
    }


    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (★ キャッシュ機能を追加) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage || !edgeCanvas) { // edgeCanvasが計算済みかもチェック
            statusText.textContent = 'エラー: メイン画像がロードされていないか、線画の計算が完了していません。';
            return;
        }
        
        terminateWorkers(); 
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';

        // --- ★ 変更点: キャッシュロジック ---
        // 1. 現在の「重い」パラメータを取得
        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput.value),
            textureWeight: parseFloat(textureWeightInput.value) / 100.0
        };

        // 2. 現在の「軽い」パラメータを取得 (描画にしか使わない)
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput.value),
            edgeOpacity: parseInt(edgeOpacityInput.value),
            brightnessCompensation: parseInt(brightnessCompensationInput.value)
        };

        // 3. キャッシュのチェック
        // (キャッシュが存在し、かつ重いパラメータが前回と全く同じ場合)
        if (cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (Worker処理をスキップ) ---
            statusText.textContent = 'ステータス: 描画パラメータのみ変更... 高速に再描画します。';
            
            // Worker処理（フェーズ1）をスキップし、
            // キャッシュされた配置図(cachedResults)を使って即座に描画（フェーズ2）を実行
            renderMosaic(
                cachedResults, 
                mainImage.width, 
                mainImage.height, 
                currentLightParams.blendOpacity, 
                currentLightParams.edgeOpacity, 
                currentLightParams.brightnessCompensation
            );
            
            // 高速描画なのですぐにボタンを有効に戻す
            generateButton.disabled = false;
            return; // ★ Worker処理に進まずここで終了
        }
        
        // --- Case 2: 通常処理 (Worker処理を実行) ---
        cachedResults = null; // キャッシュを破棄
        lastHeavyParams = currentHeavyParams; // 今回の「重い」パラメータを保存
        
        statusText.textContent = 'ステータス: タイル配置を計算中...';
        
        // (線画抽出はアップロード時に終わっているので不要)
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);

        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];
        
        // ( ... チャンク分けロジック (変更なし) ... )
        const tileSize = currentHeavyParams.tileSize; // 保存した値を使用
        const tileHeight = Math.round(tileSize * 1.0); 
        if (tileHeight <= 0) {
            statusText.textContent = 'エラー: タイルサイズは0より大きくしてください。';
            generateButton.disabled = false;
            return;
        }
        const alignedHeight = Math.ceil(mainImage.height / tileHeight) * tileHeight;
        const chunkHeight = Math.ceil(alignedHeight / numWorkers / tileHeight) * tileHeight;
        let startY = 0;
        let activeWorkers = 0; 
        
        for (let i = 0; i < numWorkers; i++) {
            const endY = Math.min(startY + chunkHeight, mainImage.height);
            if (startY >= endY) continue; 
            activeWorkers++; 
            const worker = new Worker('mosaic_worker.js');
            workers.push(worker);
            worker.onmessage = (e) => {
                if (e.data.type === 'status') {
                    statusText.textContent = `ステータス (Worker ${i+1}): ${e.data.message}`;
                } else if (e.data.type === 'progress') {
                    const currentProgress = parseFloat(progressBar.style.width) || 0;
                    const newProgress = currentProgress + (e.data.progress * 100 / activeWorkers);
                    progressBar.style.width = `${newProgress}%`;
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    if (finishedWorkers === activeWorkers) {
                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        progressBar.style.width = '100%';
                        
                        // ★ 変更点: 結果をキャッシュに保存
                        cachedResults = allResults; 
                        
                        renderMosaic(
                            cachedResults, // キャッシュした結果を渡す
                            mainImage.width, 
                            mainImage.height, 
                            currentLightParams.blendOpacity, 
                            currentLightParams.edgeOpacity, 
                            currentLightParams.brightnessCompensation
                        );
                        terminateWorkers();
                    }
                }
            };
            worker.onerror = (error) => {
                statusText.textContent = `エラー: Worker ${i+1} で問題が発生しました。 ${error.message}`;
                terminateWorkers();
                generateButton.disabled = false;
                console.error(`Worker ${i+1} Error:`, error);
            };
            worker.postMessage({ 
                imageData: imageData, 
                tileData: tileData,
                tileSize: currentHeavyParams.tileSize,
                width: mainImage.width,
                height: mainImage.height,
                brightnessCompensation: currentLightParams.brightnessCompensation,
                textureWeight: currentHeavyParams.textureWeight,
                startY: startY,
                endY: endY
            });
            startY += chunkHeight;
        }
        if (activeWorkers === 0 && mainImage.height > 0) {
             statusText.textContent = 'ステータス: Workerを起動できませんでした。';
             generateButton.disabled = false;
        }
    });

    // --- 4. 最終的なモザイクの描画 ---
    // (★ 変更なし: 陰影と線画の2段階ブレンド)
    async function renderMosaic(results, width, height, blendOpacity, edgeOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        ctx.save(); 
        ctx.beginPath();
        ctx.rect(0, 0, width, height); 
        ctx.clip(); 

        let loadedCount = 0;
        const totalTiles = results.length;
        const promises = [];
        
        const MIN_TILE_L = 5.0; 
        const MAX_BRIGHTNESS_RATIO = 5.0; 
        const brightnessFactor = brightnessCompensation / 100; 

        for (const tile of results) {
            const p = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                    const sWidth = img.naturalWidth;
                    const sHeight = img.naturalHeight;
                    const sSize = Math.min(sWidth, sHeight);
                    const isHorizontal = sWidth > sHeight; 
                    const typeParts = tile.patternType.split('_'); 
                    const cropType = typeParts[0]; 
                    const flipType = typeParts[1]; 
                    let sx = 0, sy = 0;
                    if (isHorizontal) {
                        if (cropType === "cropC") sx = Math.floor((sWidth - sSize) / 2);
                        else if (cropType === "cropR") sx = sWidth - sSize;
                    } else {
                        if (cropType === "cropM") sy = Math.floor((sHeight - sSize) / 2);
                        else if (cropType === "cropB") sy = sHeight - sSize;
                    }
                    const dx = tile.x, dy = tile.y;
                    const dWidth = tile.width, dHeight = tile.height; 

                    ctx.save();
                    if (flipType === "flip1") {
                        ctx.scale(-1, 1);
                        ctx.drawImage(img, sx, sy, sSize, sSize, -dx - dWidth, dy, dWidth, dHeight);
                    } else {
                        ctx.drawImage(img, sx, sy, sSize, sSize, dx, dy, dWidth, dHeight);
                    }
                    ctx.restore();
                    
                    ctx.filter = 'none';
                    loadedCount++;
                    resolve();
                };
                img.onerror = () => {
                    console.error(`タイル画像のロードに失敗: ${tile.url}`);
                    const grayValue = Math.round(tile.targetL * 2.55); 
                    ctx.fillStyle = `rgb(${grayValue}, ${grayValue}, ${grayValue})`; 
                    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
                    loadedCount++;
                    resolve(); 
                };
                img.src = tile.url; 
            });
            promises.push(p);
        }

        await Promise.all(promises);
        
        ctx.restore(); // クリッピングを解除

        progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';

        // 1. 「陰影」ブレンド (Soft Light)
        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'soft-light'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, width, height);
        }

        // 2. 「線画」ブレンド (Multiply)
        if (edgeOpacity > 0 && edgeCanvas) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = edgeOpacity / 100;
            ctx.drawImage(edgeCanvas, 0, 0, width, height);
        }
        
        // 3. 設定を元に戻す
        ctx.globalCompositeOperation = 'source-over'; 
        ctx.globalAlpha = 1.0; 

        statusText.textContent = 'ステータス: モザイクアートが完成しました！';
        generateButton.disabled = false;
        downloadButton.style.display = 'block';
    }

    // --- 5. ダウンロード機能 (PNG形式) ---
    downloadButton.addEventListener('click', () => {
        const dataURL = mainCanvas.toDataURL('image/png'); 
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `photomosaic-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });
});
