// ★ 変更点: 線画抽出（Sobel）のためのヘルパー関数
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
                sobelData[i] = 0; sobelData[i + 1] = 0; sobelData[i + 2] = 0;
                sobelData[i + 3] = Math.min(255, magnitude * 1.5);
            }
        }
    }
    return new ImageData(sobelData, width, height);
}
// ★ ヘルパー関数ここまで


// ★ 変更点: 画像を分析し、推奨値を返すヘルパー関数
function analyzeImageAndGetRecommendations(image) {
    const width = image.width;
    const height = image.height;

    // 1. 画像からピクセルデータを取得 (縮小して高速化)
    const analysisSize = 400; // 400x400程度に縮小して分析
    const ratio = analysisSize / Math.max(width, height);
    const w = width * ratio;
    const h = height * ratio;
    
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    
    // 2. 平均輝度(Luma)と標準偏差(コントラスト)を計算
    let sumLuma = 0;
    let sumLumaSq = 0;
    const lumaValues = [];
    
    for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sumLuma += luma;
        lumaValues.push(luma);
    }
    
    const pixelCount = data.length / 4;
    const meanLuma = sumLuma / pixelCount; // 平均輝度 (0-255)
    
    for (const luma of lumaValues) {
        sumLumaSq += (luma - meanLuma) * (luma - meanLuma);
    }
    const stdDev = Math.sqrt(sumLumaSq / pixelCount); // 標準偏差 (コントラストの目安)
    
    // 3. 推奨値を決定
    const recommendations = {};

    // タイル幅: 解像度が高いほど細かく
    if (width > 3000) recommendations.tileSize = 15;
    else if (width > 1500) recommendations.tileSize = 25;
    else recommendations.tileSize = 30;

    // L*明度補正: 常に100
    recommendations.brightnessCompensation = 100;
    
    // テクスチャ重視度: コントラストが高いほど重視
    // stdDev (0-128, typical 30-60)
    recommendations.textureWeight = Math.round(Math.min(200, stdDev * 1.5 + 20)); // 30->65, 60->110

    // ブレンド度(陰影): 暗い画像ほど弱く
    // meanLuma (0-255, typical 80-150)
    recommendations.blendRange = Math.round(Math.max(10, meanLuma / 7.0)); // 80->11, 150->21

    // 線画の強さ: コントラストが低いほど強く (アニメ塗り補完)
    recommendations.edgeOpacity = Math.round(Math.max(10, 70 - stdDev)); // 30->40, 60->10
    
    return recommendations;
}
// ★ ヘルパー関数ここまで


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    
    // スライダー本体
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const textureWeightInput = document.getElementById('texture-weight');
    
    // スライダーの値表示
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightValue = document.getElementById('texture-weight-value');
    
    // ★ 変更点: 推奨値エリアのUI
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');

    
    // 全ての必須要素が存在するかチェック
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
    
    // ★ 変更点: 推奨値を保持する変数
    let currentRecommendations = null;


    // --- UIの初期設定 ---
    generateButton.disabled = true;
    downloadButton.style.display = 'none';

    // スライダーのリスナー
    if (brightnessCompensationInput && brightnessCompensationValue) {
        brightnessCompensationInput.addEventListener('input', () => {
            brightnessCompensationValue.textContent = brightnessCompensationInput.value;
        });
    }
    if (textureWeightInput && textureWeightValue) {
        textureWeightInput.addEventListener('input', () => {
            textureWeightValue.textContent = textureWeightInput.value;
        });
    }
    if (blendRangeInput && blendValue) {
        blendRangeInput.addEventListener('input', () => {
            blendValue.textContent = blendRangeInput.value;
        });
    }
    if (edgeOpacityInput && edgeOpacityValue) {
        edgeOpacityInput.addEventListener('input', () => {
            edgeOpacityValue.textContent = edgeOpacityInput.value;
        });
    }

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
                    generateButton.disabled = false;
                    downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height);
                    ctx.drawImage(mainImage, 0, 0); // プレビュー表示
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    // ★ 変更点: 推奨値を計算し、UIに「表示」する (適用はしない)
                    try {
                        const rec = analyzeImageAndGetRecommendations(mainImage);
                        currentRecommendations = rec; // 推奨値を保持
                        
                        // 推奨値エリアのテキストを更新
                        recTileSize.textContent = rec.tileSize;
                        recBrightness.textContent = rec.brightnessCompensation;
                        recTextureWeight.textContent = rec.textureWeight;
                        recBlendRange.textContent = rec.blendRange;
                        recEdgeOpacity.textContent = rec.edgeOpacity;
                        
                        // エリアを表示
                        recommendationArea.style.display = 'block';
                        
                        statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;
                    } catch (err) {
                        console.error("Recommendation analysis failed:", err);
                        statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                        recommendationArea.style.display = 'none';
                    }
                    // ★ 変更点ここまで
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ★ 変更点: 「推奨値を適用」ボタンのリスナー
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) {
                statusText.textContent = 'ステータス: メイン画像をアップロードして、まず推奨値を計算してください。';
                return;
            }
            
            try {
                const rec = currentRecommendations;
                
                // 保持していた推奨値をスライダーと値表示の両方に適用
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
            } catch (err) {
                 console.error("Failed to apply recommendations:", err);
                 statusText.textContent = 'ステータス: 推奨値の適用に失敗しました。';
            }
        });
    }


    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (並列化ロジック) ---
    generateButton.addEventListener('click', () => {
        // ( ... 変更なし: 並列でWorkerを起動し、結果を待つ ... )
        // ( ... applySobelFilter呼び出しも変更なし ... )
        if (!mainImage) return;
        terminateWorkers(); 
        generateButton.disabled = true;
        downloadButton.style.display = 'none';
        progressBar.style.width = '0%';
        statusText.textContent = 'ステータス: 画像データの準備中...';
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mainImage.width;
        tempCanvas.height = mainImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(mainImage, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, mainImage.width, mainImage.height);
        statusText.textContent = 'ステータス: メイン画像の線画を抽出中...';
        const edgeImageData = applySobelFilter(imageData);
        edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
        edgeCanvas.getContext('2d').putImageData(edgeImageData, 0, 0);
        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;
        let finishedWorkers = 0;
        let allResults = [];
        const tileSize = parseInt(tileSizeInput.value);
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
                        renderMosaic(
                            allResults, 
                            mainImage.width, 
                            mainImage.height, 
                            parseInt(blendRangeInput.value), // ブレンド度
                            parseInt(edgeOpacityInput.value), // 線画の強さ
                            parseInt(brightnessCompensationInput.value)
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
                tileSize: tileSize,
                width: mainImage.width,
                height: mainImage.height,
                brightnessCompensation: parseInt(brightnessCompensationInput.value),
                textureWeight: parseFloat(textureWeightInput.value) / 100.0,
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
