{
type: uploaded file
fileName: main.js
fullContent:
// 線画抽出（Sobel）のためのヘルパー関数
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
    
    // 3段階の閾値
    const thresholds = {
        low: 15, // 弱いディテール（質感）
        med: 30, // 最終描画用の線画
        high: 80 // 強い輪郭（アニメ線など）
    };
    
    // 3段階のディテール量を格納するベクトル
    const detailVector = { low: 0, med: 0, high: 0 };

    // 2. Sobelフィルタ適用 (1回のループで全て計算)
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            let sumX = 0;
            let sumY = 0;

            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const idx = ((y + ky) * width + (x + kx));
                    if (idx < 0 || idx >= grayscaleData.length) continue; // 境界チェック
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
                finalSobelData[i] = 0;    // R (黒)
                finalSobelData[i + 1] = 0; // G (黒)
                finalSobelData[i + 2] = 0; // B (黒)
                finalSobelData[i + 3] = alpha; // A (不透明度)
                
                detailVector.med += alpha; // 中ディテール量
            }
            
            // 2. 賢い評価用の特徴ベクトル
            if (magnitude > thresholds.high) {
                detailVector.high += magnitude;
            }
        }
    }
    
    return { 
        finalEdgeImageData: new ImageData(finalSobelData, width, height), 
        detailVector: detailVector
    };
}

// 画像を分析し、推奨値を返すヘルパー関数
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
    
    const edgeResult = applySobelFilter(analysisImageData); 
    const detailVector = edgeResult.detailVector; 
    
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
    
    return recommendations;
}
// ヘルパー関数ここまで


// ★ 修正点: ダウンロードアドバイスのためのヘルパー関数
function highlightParameter(element) {
    if (!element) return;
    element.style.borderColor = '#dc2626'; // Red-600
    element.style.borderWidth = '2px';
    element.style.boxShadow = '0 0 5px rgba(220, 38, 38, 0.5)';
}
function resetParameterStyles(elements) {
    elements.forEach(element => {
        if (element) {
            element.style.borderColor = '';
            element.style.borderWidth = '';
            element.style.boxShadow = '';
        }
    });
}


document.addEventListener('DOMContentLoaded', async () => {
    // --- UI要素の取得 ---
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const edgeOpacityInput = document.getElementById('edge-opacity-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const textureWeightInput = document.getElementById('texture-weight');
    const blendValue = document.getElementById('blend-value');
    const edgeOpacityValue = document.getElementById('edge-opacity-value');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    const textureWeightValue = document.getElementById('texture-weight-value');
    const recommendationArea = document.getElementById('recommendation-area');
    const applyRecommendationsButton = document.getElementById('apply-recommendations-button');
    const recTileSize = document.getElementById('rec-tile-size');
    const recBrightness = document.getElementById('rec-brightness');
    const recTextureWeight = document.getElementById('rec-texture-weight');
    const recBlendRange = document.getElementById('rec-blend-range');
    const recEdgeOpacity = document.getElementById('rec-edge-opacity');
    
    // 高速プレビューモード
    const previewModeCheckbox = document.getElementById('preview-mode-checkbox');

    const downloadSpinner = document.getElementById('download-spinner');
    const downloadWarningArea = document.getElementById('download-warning-area');
    const downloadWarningMessage = document.getElementById('download-warning-message');
    const warningYesButton = document.getElementById('warning-yes-button');
    const warningNoButton = document.getElementById('warning-no-button');
    const resolutionScaleInput = document.getElementById('resolution-scale');
    const jpegQualityInput = document.getElementById('jpeg-quality');
    
    const timingLog = document.getElementById('timing-log'); // ★ null の可能性がある

    
    // ( ... 必須要素チェック (null許容) ... )
    if (!mainCanvas || !statusText || !generateButton || !mainImageInput || !previewModeCheckbox || !tileSizeInput) {
        console.error("Initialization Error: One or more critical HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because critical elements (Canvas, Buttons, Status, mainImageInput, previewModeCheckbox, tileSizeInput) are missing from the HTML.</p>";
        return;
    }
    
    // ★★★ 修正点: timingLog が null でもクラッシュしないよう保護 ★★★
    if (timingLog) {
        timingLog.textContent = ''; // ログをクリア
        const cpuCores = navigator.hardwareConcurrency || 'N/A';
        const deviceRam = navigator.deviceMemory || 'N/A';
        timingLog.innerHTML = `[環境] CPUコア: ${cpuCores}, RAM: ${deviceRam} GB`;
    }
    // ★★★ 修正点ここまで ★★★
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null; // ★ 構造変更: { tileSets: ..., tiles: [...] }
    let mainImage = null; // ★ 修正: 元画像(Image)を保持
    let workers = []; // F1 (計算) Worker用
    let edgeCanvas = null; // ★ 修正: 線画(OffscreenCanvas)を保持
    let currentRecommendations = null;
    let cachedResults = null; // ★ 構造変更: [ { tileId: 0, patternType: "...", x: 0, y: 0, ... }, ... ]
    let lastHeavyParams = {}; 
    let isGeneratingFullRes = false; 
    let lastGeneratedBlob = null; 
    
    // ★ 修正: F2プレビュー用のスプライトシート (Image)
    let thumbSheetImage = null; 

    // ★ 修正: F2実行中フラグ
    let isGeneratingPreview = false;
    
    let t_worker_start = 0;


    // ( ... UIの初期設定 (スライダーリスナー) ... )
    generateButton.disabled = true;
    if(downloadButton) downloadButton.style.display = 'none';
    if (brightnessCompensationInput && brightnessCompensationValue) { /* ... */ }
    if (textureWeightInput && textureWeightValue) { /* ... */ }
    if (blendRangeInput && blendValue) { /* ... */ }
    if (edgeOpacityInput && edgeOpacityValue) { /* ... */ }


    // --- 1. タイルデータの初期ロード ---
    try {
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        
        // ★ 修正点: ネットワークエラーを詳細に表示
        if (!response.ok) { 
            //例: 404 Not Found
            throw new Error(`HTTP ${response.status} - ${response.statusText}`); 
        }
        
        tileData = await response.json();
        
        // ★ 修正: スプライトシート用のJSON構造を検証
        if (!tileData || !tileData.tileSets || !tileData.tileSets.thumb || !tileData.tiles || tileData.tiles.length === 0) {
             throw new Error('tile_data.jsonがスプライトシート形式ではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        // ★ 修正: F2プレビュー用のサムネイル・スプライトシートを先行ロード
        statusText.textContent = `ステータス: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) をロード中...`;
        thumbSheetImage = new Image();
        thumbSheetImage.onload = () => {
            statusText.textContent = `ステータス: プレビュー準備完了 (${tileData.tiles.length}タイル)。メイン画像を選択してください。`;
            if (mainImageInput) mainImageInput.disabled = false;
        };
        thumbSheetImage.onerror = () => {
            statusText.textContent = `エラー: プレビュースプライトシート (${tileData.tileSets.thumb.sheetUrl}) のロードに失敗しました。`;
            console.error("Failed to load thumbnail sprite sheet.");
        };
        thumbSheetImage.src = tileData.tileSets.thumb.sheetUrl;

    } catch (error) {
        // ★ 修正点: ネットワークエラーか、JSONパースエラーかを明記
        console.error("Initialization Error:", error); // コンソールに完全なエラーを出力
        
        if (error instanceof TypeError) {
             //例: fetch自体が失敗 (CORS or ネットワークオフライン)
             statusText.textContent = `エラー: ネットワーク接続に失敗しました (CORS or 接続拒否)。${error.message}`;
        } else if (error.message.includes('HTTP')) {
             //例: 404 Not Found
             statusText.textContent = `エラー: tile_data.json のロードに失敗しました (${error.message})。ファイルが正しい場所に配置されているか確認してください。`;
        } else {
             //例: JSONが壊れている
             statusText.textContent = `エラー: tile_data.json の解析に失敗しました。ファイルが破損している可能性があります。${error.message}`;
        }
        return; // エラーが起きたらここで停止
    }
    
    // ( ... 2. メイン画像アップロード (推奨値/線画計算) ... )
    if (mainImageInput) {
        mainImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                
                mainImage = new Image();
                mainImage.onload = () => {
                    cachedResults = null;
                    lastHeavyParams = {};
                    generateButton.disabled = false;
                    if(downloadButton) downloadButton.style.display = 'none';
                    mainCanvas.width = mainImage.width;
                    mainCanvas.height = mainImage.height;
                    
                    // Canvasを元画像でリセット
                    ctx.clearRect(0, 0, mainImage.width, mainImage.height); 
                    ctx.drawImage(mainImage, 0, 0); 
                    
                    statusText.textContent = `ステータス: 画像ロード完了。推奨値を計算中...`;

                    if (recommendationArea && applyRecommendationsButton) {
                        try {
                            const analysisSize = 400; 
                            const ratio = analysisSize / Math.max(mainImage.width, mainImage.height);
                            const w = mainImage.width * ratio;
                            const h = mainImage.height * ratio;
                            const analysisCanvas = new OffscreenCanvas(w, h);
                            const analysisCtx = analysisCanvas.getContext('2d');
                            analysisCtx.drawImage(mainImage, 0, 0, w, h);
                            const analysisImageData = analysisCtx.getImageData(0, 0, w, h);
                            const recommendations = analyzeImageAndGetRecommendations(mainImage, analysisImageData);
                            currentRecommendations = recommendations; 
                            statusText.textContent = `ステータス: フルサイズの線画を事前計算中...`;
                            
                            // ★ 修正: ここでフルサイズのImageDataを取得
                            const fullImageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height);
                            const fullEdgeResult = applySobelFilter(fullImageData);
                            
                            // ★ 修正: edgeCanvas (OffscreenCanvas) を保持
                            edgeCanvas = new OffscreenCanvas(mainImage.width, mainImage.height);
                            edgeCanvas.getContext('2d').putImageData(fullEdgeResult.finalEdgeImageData, 0, 0);
                            
                            if (recTileSize) recTileSize.textContent = recommendations.tileSize;
                            if (recBrightness) recBrightness.textContent = recommendations.brightnessCompensation;
                            if (recTextureWeight) recTextureWeight.textContent = recommendations.textureWeight;
                            if (recBlendRange) recBlendRange.textContent = recommendations.blendRange;
                            if (recEdgeOpacity) recEdgeOpacity.textContent = recommendations.edgeOpacity;
                            recommendationArea.style.display = 'block';
                            statusText.textContent = `ステータス: 推奨値を表示しました。適用ボタンを押すか、手動で設定してください。`;
                        } catch (err) {
                            console.error("Recommendation analysis failed:", err);
                            statusText.textContent = `ステータス: 画像ロード完了 (推奨値の計算に失敗)。`;
                            if (recommendationArea) recommendationArea.style.display = 'none';
                        }
                    } else { /* ( ... 推奨値エリアなしの場合 ... ) */ }
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // ( ... applyRecommendationsButton リスナー (変更なし) ... )
    if (applyRecommendationsButton) {
        applyRecommendationsButton.addEventListener('click', () => {
            if (!currentRecommendations) return;
            
            // 1. タイル幅 (number input)
            if (tileSizeInput) tileSizeInput.value = currentRecommendations.tileSize;
            // 2. L*明度補正 (range slider)
            if (brightnessCompensationInput) {
                brightnessCompensationInput.value = currentRecommendations.brightnessCompensation;
                if (brightnessCompensationValue) brightnessCompensationValue.textContent = currentRecommendations.brightnessCompensation;
            }
            // 3. テクスチャ重視度 (range slider)
            if (textureWeightInput) {
                textureWeightInput.value = currentRecommendations.textureWeight;
                if (textureWeightValue) textureWeightValue.textContent = currentRecommendations.textureWeight;
            }
            // 4. ブレンド度 (range slider)
            if (blendRangeInput) {
                blendRangeInput.value = currentRecommendations.blendRange;
                if (blendValue) blendValue.textContent = currentRecommendations.blendRange;
            }
            // 5. 線画の強さ (range slider)
            if (edgeOpacityInput) {
                edgeOpacityInput.value = currentRecommendations.edgeOpacity;
                if (edgeOpacityValue) edgeOpacityValue.textContent = currentRecommendations.edgeOpacity;
            }
            statusText.textContent = 'ステータス: 推奨パラメータを適用しました。';
            cachedResults = null;
            lastHeavyParams = {};
            generateButton.disabled = false;
        });
    }

    function terminateWorkers() {
        workers.forEach(worker => worker.terminate());
        workers = [];
    }
    
    // ( ... F3 プリロード (バックグラウンド・ロード) 戦略 (変更なし) ... )
    
    async function runBatchedLoads(loadPromises, maxConcurrency) {
        const running = [];
        const results = []; 
        for (const loadPromise of loadPromises) {
            const p = loadPromise().then(result => {
                running.splice(running.indexOf(p), 1);
                results.push(result);
                return result;
            });
            running.push(p);
            if (running.length >= maxConcurrency) {
                await Promise.race(running);
            }
        }
        return Promise.all(running);
    }
    
    let preloadPromise = null; // ★ F3プリロードの完了を待つためのPromise
    
    function startF3Preload(tileData, cachedResults) {
        // 1. 必須シートリストを作成
        const requiredTileIds = new Set(cachedResults.map(result => result.tileId));
        const requiredSheetIndices = new Set();
        requiredTileIds.forEach(id => {
            const tileInfo = tileData.tiles[id];
            if (tileInfo) {
                requiredSheetIndices.add(tileInfo.fullCoords.sheetIndex);
            }
        });
        const requiredSheetIndicesArray = [...requiredSheetIndices];
        
        // 2. 必須シートのURLリストを作成
        const fullSet = tileData.tileSets.full;
        const urlsToPreload = requiredSheetIndicesArray.map(index => fullSet.sheetUrls[index]);

        console.log(`[F3 Preload] F1完了。${urlsToPreload.length}枚のF3スプライトシートのプリロードを開始します。`);
        
        // 3. プリロード (fetch) を実行
        const MAX_PRELOAD_CONCURRENCY = 10;
        const preloadTasks = urlsToPreload.map(url => {
            return () => fetch(url, { mode: 'cors' })
                         .catch(err => console.warn(`[F3 Preload] プリロード失敗: ${url}`, err));
        });
        
        // ★ 修正: グローバル変数にPromiseを保持
        preloadPromise = runBatchedLoads(preloadTasks, MAX_PRELOAD_CONCURRENCY);
        
        if(timingLog) timingLog.textContent += `\n[F3 Preload] F3高画質シート (${urlsToPreload.length}枚) のプリロードを開始... (並列数: ${MAX_PRELOAD_CONCURRENCY})`;
    }


    // --- 3. モザイク生成開始 (F1計算 + F2 Worker呼び出し) ---
    generateButton.addEventListener('click', async () => {
        if (!mainImage || !edgeCanvas || !thumbSheetImage.complete) {
            statusText.textContent = 'エラー: メイン画像またはスプライトシートが準備できていません。';
            return; 
        }
        // ★ 修正: F1実行中 / F2実行中 / F3実行中 はいずれもブロック
        if (workers.length > 0 || isGeneratingPreview || isGeneratingFullRes) {
            console.warn("[Button Click] 既に別の処理が実行中です。");
            return;
        }

        terminateWorkers(); // F1 Workerを念のためクリア
        generateButton.disabled = true;
        if (downloadButton) downloadButton.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';
        
        // ★ 修正: 環境ログを保持しつつ、以降のログをリセット
        if (timingLog) {
            const envLog = timingLog.innerHTML.split('\n')[0]; // 1行目 (環境ログ) を保持
            timingLog.innerHTML = envLog; 
        }

        const currentHeavyParams = {
            src: mainImage.src,
            tileSize: parseInt(tileSizeInput ? tileSizeInput.value : 20), 
            textureWeight: parseFloat(textureWeightInput ? textureWeightInput.value : 50) / 100.0 
        };
        const currentLightParams = {
            blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
            edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
            brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
        };
        
        const isTileSizeChanged = lastHeavyParams.tileSize !== currentHeavyParams.tileSize;
        
        // 3. キャッシュのチェック
        // タイルサイズが変わっておらず、かつ、キャッシュが存在し、その他HeavyParamsが変わっていない場合のみ高速再描画
        if (!isTileSizeChanged && cachedResults && JSON.stringify(lastHeavyParams) === JSON.stringify(currentHeavyParams)) {
            
            // --- Case 1: 高速再描画 (Worker処理(F1)をスキップ) ---
            statusText.textContent = 'ステータス: 描画パラメータのみ変更... 高速に再描画します。';
            
            // ★ 修正: F2 Workerを呼び出す
            await renderMosaicWithWorker(
                mainCanvas,
                cachedResults,
                currentLightParams
            );
            
            return; 
        }
        
        // --- Case 2: 通常処理 (F1 Worker処理を実行) ---
        cachedResults = null; 
        preloadPromise = null; // ★ 修正: F1再計算のため、プリロードPromiseをリセット
        lastHeavyParams = currentHeavyParams; 
        statusText.textContent = 'ステータス: タイル配置を計算中...';
        
        t_worker_start = performance.now(); 
        
        ctx.clearRect(0, 0, mainImage.width, mainImage.height);
        ctx.drawImage(mainImage, 0, 0); 
        
        const imageData = ctx.getImageData(0, 0, mainImage.width, mainImage.height); // ★ クリーンな元画像データを取得
        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];
        
        // ( ... チャンク分けロジック ... )
        const tileSize = currentHeavyParams.tileSize; 
        const tileHeight = Math.round(tileSize * 1.0); 
        if (tileHeight <= 0) { /* ... */ }
        const alignedHeight = Math.ceil(mainImage.height / tileHeight) * tileHeight;
        const chunkHeight = Math.ceil(alignedHeight / numWorkers / tileHeight) * tileHeight;
        let startY = 0;
        let activeWorkers = 0; 
        
        for (let i = 0; i < numWorkers; i++) {
            const endY = Math.min(startY + chunkHeight, mainImage.height);
            if (startY >= endY) continue; 
            activeWorkers++; 
            const worker = new Worker('mosaic_worker.js');
            workers.push(worker); // F1 Workerをリストに追加
            worker.onmessage = async (e) => { // ★ 修正: F1完了後にF2を呼ぶため async
                if (e.data.type === 'status') {
                    statusText.textContent = `ステータス (Worker ${i+1}): ${e.data.message}`;
                } else if (e.data.type === 'progress') {
                    // ( ... プログレスバー ... )
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    
                    if (finishedWorkers === activeWorkers) {
                        // --- F1 (計算) 完了 ---
                        const t_worker_end = performance.now();
                        const workerTime = (t_worker_end - t_worker_start) / 1000.0;
                        
                        if(timingLog) timingLog.textContent += `\n[F1] Worker 配置計算 (F1): ${workerTime.toFixed(3)} 秒 (タイル総数: ${tileData.tiles.length})`;

                        statusText.textContent = 'ステータス: 全ワーカー処理完了。F2プレビュー描画中...';
                        if (progressBar) progressBar.style.width = '100%';
                        
                        cachedResults = allResults; 
                        
                        // ★ 修正: F1完了後、F2 Workerを呼び出す
                        await renderMosaicWithWorker(
                            mainCanvas,
                            cachedResults, 
                            currentLightParams
                        );
                        
                        // F2描画と並行してF3プリロードを開始
                        startF3Preload(tileData, cachedResults);
                        
                        terminateWorkers(); // F1 Workerを解放
                    }
                }
            };
            worker.onerror = (error) => { /* ... */ };
            
            // F1 Workerに処理を依頼
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
        if (activeWorkers === 0 && mainImage.height > 0) { /* ... */ }
    });

    // --- 4. 最終的なモザイクの描画 (F2) ---
    
    // ★★★ 修正点: F2 (プレビュー) 描画を Worker に移譲 ★★★
    
    /**
     * preview_worker.js を起動し、F2描画を実行する
     */
    async function renderMosaicWithWorker(
        targetCanvas, 
        results, // F1 (Worker) からの { tileId, ... } 配列
        lightParams
    ) {
        if (isGeneratingPreview) return; // F2実行中は何もしない
        isGeneratingPreview = true;
        generateButton.disabled = true; // F2実行中はボタンを無効化
        
        const t_f2_start = performance.now(); // F2準備開始

        try {
            statusText.textContent = `ステータス: F2プレビューWorkerを起動中...`;
            
            // 1. Workerに転送するImageBitmapを都度作成
            const mainImageBitmap = await createImageBitmap(mainImage);
            const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
            const thumbSheetBitmap = await createImageBitmap(thumbSheetImage);
            
            const t_f2_bitmap_end = performance.now();
            
            statusText.textContent = `ステータス: F2プレビュー描画中... (Worker実行中)`;
            
            const previewWorker = new Worker('./preview_worker.js');
            
            const workerPromise = new Promise((resolve, reject) => {
                previewWorker.onmessage = (e) => {
                    if (e.data.type === 'complete') {
                        // F2 Worker 完了
                        const finalBitmap = e.data.bitmap;
                        const ctx = targetCanvas.getContext('2d');
                        
                        // メインスレッドの仕事は、完成品を1回描画するだけ
                        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
                        ctx.drawImage(finalBitmap, 0, 0);
                        finalBitmap.close(); // Bitmapを解放
                        
                        // F2メトリクスをログに追加
                        if(timingLog) {
                            timingLog.textContent += `\n[F2] Worker 描画 (F2) 合計: ${e.data.totalTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2-A: タイル描画 (Worker): ${e.data.tileTime.toFixed(3)} 秒`;
                            timingLog.textContent += `\n  - F2-B: ブレンド (Worker): ${e.data.blendTime.toFixed(3)} 秒`;
                        }
                        
                        resolve();
                    } else if (e.data.type === 'error') {
                        reject(new Error(e.data.message));
                    }
                    previewWorker.terminate();
                };
                previewWorker.onerror = (error) => {
                    reject(new Error(`F2 Worker error: ${error.message}`));
                    previewWorker.terminate();
                };
                
                // 2. F2 Workerに処理を依頼 (Bitmapを転送)
                previewWorker.postMessage({
                    tileData: tileData,
                    cachedResults: results,
                    mainImageBitmap: mainImageBitmap,
                    edgeImageBitmap: edgeImageBitmap,
                    thumbSheetBitmap: thumbSheetBitmap,
                    width: mainImage.width,
                    height: mainImage.height,
                    lightParams: lightParams
                }, [mainImageBitmap, ...(edgeImageBitmap ? [edgeImageBitmap] : []), thumbSheetBitmap]); // 転送リスト
            });
            
            await workerPromise; // F2 Workerの完了を待つ

            const t_f2_end = performance.now();
            const bitmapTime = (t_f2_bitmap_end - t_f2_start) / 1000.0;
            const totalF2Time = (t_f2_end - t_f2_start) / 1000.0;

            if(timingLog) {
                 timingLog.textContent += `\n[F2] メインスレッド待機 (F2総時間): ${totalF2Time.toFixed(3)} 秒 (Bitmap準備: ${bitmapTime.toFixed(3)}秒)`;
            }

            statusText.textContent = 'ステータス: モザイクアートが完成しました！';
            
        } catch (err) {
            statusText.textContent = `エラー: F2プレビュー描画に失敗しました。 ${err.message}`;
            console.error("F2 Preview Worker failed:", err);
        } finally {
            isGeneratingPreview = false;
            generateButton.disabled = false;
            if (downloadButton) downloadButton.style.display = 'block';
        }
    }
    // ★★★ F2 修正ここまで ★★★

    // --- 5. ダウンロード機能 (F3) ---
    if (downloadButton) {
        // ( ... F3 ダウンロード機能 (変更なし) ... )
        const allDownloadParams = [resolutionScaleInput, jpegQualityInput];

        downloadButton.addEventListener('click', async () => {
            resetParameterStyles(allDownloadParams);
            
            // ★ 修正: F1/F2/F3が実行中ならブロック
            if (workers.length > 0 || isGeneratingPreview || isGeneratingFullRes) {
                console.warn("[Button Click] 既に別の処理が実行中です。");
                return;
            } 
            if (!cachedResults || !mainImage) { /* ... */ return; }

            if (downloadWarningArea) downloadWarningArea.style.display = 'none';
            lastGeneratedBlob = null;
            
            try {
                isGeneratingFullRes = true;
                generateButton.disabled = true;
                downloadButton.disabled = true;
                if (downloadSpinner) downloadSpinner.style.display = 'inline-block';
                statusText.textContent = 'ステータス: 高画質版を生成中... (時間がかかります)';

                const t_download_start = performance.now(); // ★ タイマー開始 (F3)
                
                // ★★★ 修正点: F3プリロードの完了を待機 ★★★
                statusText.textContent = 'ステータス: F3プリロードの完了を待機中...';
                if (!preloadPromise) {
                    // F1実行直後にF3を押した場合など (通常はF2完了時点でF3Preloadは開始されている)
                    console.warn("F3 Preload promise is missing, starting it now.");
                    startF3Preload(tileData, cachedResults);
                    if (!preloadPromise) { // これでもnullならF1が壊れている
                         throw new Error("F3 Preload could not be started.");
                    }
                }
                
                const t_wait_start = performance.now();
                await preloadPromise; // F3プリロードが完了するまでここで待機
                const t_wait_end = performance.now();
                
                if(timingLog) {
                    timingLog.textContent += `\n[F3] メインスレッド: プリロード待機: ${(t_wait_end - t_wait_start) / 1000.0} 秒`;
                }
                statusText.textContent = 'ステータス: プリロード完了。F3 Workerを起動します...';
                // ★★★ 修正点ここまで ★★★

                const lightParams = {
                    blendOpacity: parseInt(blendRangeInput ? blendRangeInput.value : 30),
                    edgeOpacity: parseInt(edgeOpacityInput ? edgeOpacityInput.value : 30),
                    brightnessCompensation: parseInt(brightnessCompensationInput ? brightnessCompensationInput.value : 100)
                };
                const scale = parseFloat(resolutionScaleInput ? resolutionScaleInput.value : 1.0);
                const quality = parseInt(jpegQualityInput ? jpegQualityInput.value : 90) / 100.0; 

                // ★ F3 Worker化のためにメイン画像をImageBitmapに変換 (F2と同様)
                const mainImageBitmap = await createImageBitmap(mainImage);
                const edgeImageBitmap = edgeCanvas ? await createImageBitmap(edgeCanvas) : null;
                
                statusText.textContent = 'ステータス: Workerに描画とエンコードを委譲中...';

                // F3 オンデマンド・ロードのため、必須シートリストを作成
                const requiredTileIds = new Set(cachedResults.map(result => result.tileId));
                const requiredSheetIndices = new Set();
                requiredTileIds.forEach(id => {
                    const tileInfo = tileData.tiles[id];
                    if (tileInfo) {
                        requiredSheetIndices.add(tileInfo.fullCoords.sheetIndex);
                    }
                });
                const requiredSheetIndicesArray = [...requiredSheetIndices];
                
                const downloadWorker = new Worker('./download_worker.js'); 
                
                const workerPromise = new Promise((resolve, reject) => {
                    downloadWorker.onmessage = (e) => {
                        if (e.data.type === 'complete') {
                            
                            // F3 詳細メトリクスをログに追加
                            if (timingLog) {
                                timingLog.textContent += `\n[F3] Worker 描画/エンコード総時間: ${e.data.totalTime.toFixed(3)} 秒`;
                                timingLog.textContent += `\n  - F3-A1: スプライトシートロード: ${e.data.loadTime.toFixed(3)} 秒 (${e.data.sheetCount}枚, ${e.data.totalLoadSizeMB.toFixed(2)} MB)`;
                                timingLog.textContent += `\n  - F3-A1: Fetchリトライ/失敗回数: ${e.data.retryCount} 回 / ${e.data.failCount} 回`;
                                timingLog.textContent += `\n  - F3-A2: Worker 描画: ${e.data.renderTime.toFixed(3)} 秒`;
                                timingLog.textContent += `\n  - F3-B: Worker エンコード: ${e.data.encodeTime.toFixed(3)} 秒 (${e.data.finalFileSizeMB.toFixed(2)} MB)`;
                            }
                            
                            const blob = new Blob([e.data.buffer], { type: e.data.mimeType });
                            resolve(blob);
                        } else if (e.data.type === 'error') {
                            reject(new Error(e.data.message));
                        }
                        downloadWorker.terminate();
                        mainImageBitmap.close(); // 転送後のクリーンアップ
                        if (edgeImageBitmap) edgeImageBitmap.close();
                    };
                    downloadWorker.onerror = (error) => {
                        reject(new Error(`Worker error: ${error.message}`));
                        downloadWorker.terminate();
                        mainImageBitmap.close();
                        if (edgeImageBitmap) edgeImageBitmap.close();
                    };
                    
                    // Workerに全データとWorker内で実行する描画関数を渡す
                    downloadWorker.postMessage({
                        tileData: tileData, 
                        cachedResults: cachedResults,
                        requiredSheetIndices: requiredSheetIndicesArray, 
                        mainImageBitmap: mainImageBitmap, 
                        edgeImageBitmap: edgeImageBitmap,
                        width: mainImage.width,
                        height: mainImage.height,
                        lightParams: lightParams,
                        scale: scale,
                        quality: quality
                    }, [mainImageBitmap, ...(edgeImageBitmap ? [edgeImageBitmap] : [])]); // 転送リスト
                });
                
                const blob = await workerPromise;
                
                const t_download_blob_end = performance.now(); // ★ Worker完了時間

                const downloadRenderTime = (t_download_blob_end - t_download_start) / 1000.0;
                if (timingLog) {
                    timingLog.textContent += `\n---`;
                    timingLog.textContent += `\n[F3] メインスレッド待機 (F3 総時間): ${downloadRenderTime.toFixed(3)} 秒`; 
                }

                // ( ... ファイルサイズチェックと警告 (変更なし) ... )
                const fileSizeMB = blob.size / 1024 / 1024;
                const limitMB = 15;
                if (fileSizeMB <= limitMB || !downloadWarningArea) {
                    statusText.textContent = `ステータス: 高画質版 ( ${fileSizeMB.toFixed(1)} MB) の準備完了。`;
                    downloadBlob(blob, `photomosaic-${Date.now()}.jpg`);
                } else {
                    lastGeneratedBlob = blob; 
                    downloadWarningMessage.textContent = `警告: ファイルサイズが ${fileSizeMB.toFixed(1)} MB となり、X/Twitterの上限(15MB)を超えています。このままダウンロードしますか？`;
                    downloadWarningArea.style.display = 'block';
                    statusText.textContent = 'ステータス: 警告！ ファイルサイズが15MBを超えました。';
                }

            } catch (err) {
                statusText.textContent = `エラー: 高画質版の生成またはダウンロードに失敗しました。 ${err.message}`;
                console.error("Download failed:", err);
            } finally {
                isGeneratingFullRes = false;
                generateButton.disabled = false;
                if (downloadWarningArea.style.display !== 'block') {
                     downloadButton.disabled = false;
                }
            }
        });
    }

    // --- 6. 警告ボタンのリスナー (変更なし) ---
    if (warningYesButton && warningNoButton) {
        const allDownloadParams = [resolutionScaleInput, jpegQualityInput];
        
        warningYesButton.addEventListener('click', () => {
            if (!lastGeneratedBlob) return;
            downloadWarningArea.style.display = 'none';
            resetParameterStyles(allDownloadParams);
            downloadBlob(lastGeneratedBlob, `photomosaic-${Date.now()}.jpg`);
            statusText.textContent = 'ステータス: 警告を無視してダウンロードを実行しました。';
            generateButton.disabled = false;
            downloadButton.disabled = false;
        });

        warningNoButton.addEventListener('click', () => {
            downloadWarningArea.style.display = 'none';
            resetParameterStyles(allDownloadParams); 
            const currentScale = parseFloat(resolutionScaleInput.value);
            const currentQuality = parseInt(jpegQualityInput.value);
            const newScale = Math.max(1.0, currentScale - 0.5); 
            const newQuality = Math.max(70, currentQuality - 10); 
            let advice = 'ダウンロードをキャンセルしました。15MBの制限を超えるため、以下のパラメータを変更し、再生成してください:\n';
            advice += ` - 💡 **解像度スケール**を現在の ${currentScale.toFixed(1)}x から **${newScale.toFixed(1)}x** に下げてみてください。（ファイルサイズへの影響が最大です）\n`;
            advice += ` - 📷 または **JPEG 品質**を現在の ${currentQuality}% から **${newQuality}%** に下げてみてください。\n`;
            statusText.textContent = advice;
            highlightParameter(resolutionScaleInput);
            highlightParameter(jpegQualityInput);
            generateButton.disabled = false;
            downloadButton.disabled = false;
        });
    }

});

// ( ... downloadBlobヘルパー関数 (変更なし) ... )
function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100); 
}
}
