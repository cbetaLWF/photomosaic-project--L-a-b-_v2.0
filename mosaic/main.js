document.addEventListener('DOMContentLoaded', async () => {
    // UI要素の取得
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    const downloadButton = document.getElementById('download-button');
    const mainCanvas = document.getElementById('main-canvas');
    const progressBar = document.getElementById('progress-fill');
    const statusText = document.getElementById('status-text');
    const tileSizeInput = document.getElementById('tile-size');
    const blendRangeInput = document.getElementById('blend-range');
    const brightnessCompensationInput = document.getElementById('brightness-compensation');
    const brightnessCompensationValue = document.getElementById('brightness-compensation-value');
    
    // 「テクスチャ重視度」スライダー
    const textureWeightInput = document.getElementById('texture-weight');
    const textureWeightValue = document.getElementById('texture-weight-value');
    
    // 全ての必須要素が存在するかチェック
    if (!mainCanvas || !statusText || !generateButton) {
        console.error("Initialization Error: One or more required HTML elements are missing.");
        document.body.innerHTML = "<h1>Initialization Error</h1><p>The application failed to load because required elements (Canvas, Buttons, Status) are missing from the HTML.</p>";
        return;
    }
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];

    // --- UIの初期設定 ---
    generateButton.disabled = true;
    downloadButton.style.display = 'none';

    // ( ... スライダーのリスナー ... )
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

    // --- 1. タイルデータの初期ロード ---
    try {
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) {
            throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。Analyzer Appでデータを作成し、/mosaic/フォルダに配置してください。`);
        }
        tileData = await response.json();
        
        // ( ... 6倍拡張(3x3)ベクトルのJSONチェック ... )
        if (tileData.length === 0 || 
            !tileData[0].patterns || 
            tileData[0].patterns.length === 0 || 
            !tileData[0].patterns[0].l_vector ||
            tileData[0].patterns[0].l_vector.length !== 9) {
             throw new Error('tile_data.jsonが古いか 6倍拡張(3x3)ベクトルではありません。Analyzer Appで新しいデータを再生成してください。');
        }
        
        statusText.textContent = `ステータス: タイルデータ (${tileData.length}枚 / ${tileData.length * 6}パターン) ロード完了。メイン画像を選択してください。`;
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
                    statusText.textContent = `ステータス: 画像ロード完了 (${mainImage.width}x${mainImage.height})。生成ボタンを押してください。`;
                };
                mainImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }

    // --- 3. モザイク生成開始 (並列化ロジック) ---
    generateButton.addEventListener('click', () => {
        if (!mainImage) return;
        
        terminateWorkers(); // 念のため既存のWorkerを終了
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

        // PCのコア数を取得 (フォールバックで4)
        const numWorkers = navigator.hardwareConcurrency || 4;
        statusText.textContent = `ステータス: ${numWorkers}コアを検出し、並列処理を開始...`;

        let finishedWorkers = 0;
        let allResults = [];

        // ★★★ ここからが修正点 ★★★

        // 1. タイルの高さを取得 (アスペクト比 1.0)
        const tileSize = parseInt(tileSizeInput.value);
        const tileHeight = Math.round(tileSize * 1.0); 

        // 2. 画像全体の高さを、タイルの高さの倍数に切り上げる (例: 1080 -> 1080, 1085 -> 1100)
        const alignedHeight = Math.ceil(mainImage.height / tileHeight) * tileHeight;
        
        // 3. チャンクの高さを、タイルの高さの倍数になるように計算
        // (例: 1080 / 4 = 270。 270 / 20 = 13.5 -> 14 (切り上げ) * 20 = 280px)
        const chunkHeight = Math.ceil(alignedHeight / numWorkers / tileHeight) * tileHeight;

        let startY = 0;
        let activeWorkers = 0; // 実際に起動したWorkerの数
        
        // コア数分だけWorkerを起動するループ
        for (let i = 0; i < numWorkers; i++) {
            // 4. endY の計算 (startY + チャンク高 or 画像の高さ)
            const endY = Math.min(startY + chunkHeight, mainImage.height);

            // 5. このWorkerが担当する行が残っているかチェック
            if (startY >= endY) {
                // (例: 5人目のWorkerだが、4人目で処理が終わった場合)
                continue; // このWorkerは起動しない
            }
            
            activeWorkers++; // 起動するWorkerをカウント
            
            // ★★★ ここまでが修正点 ★★★


            const worker = new Worker('mosaic_worker.js');
            workers.push(worker);

            // Workerからのメッセージ受信
            worker.onmessage = (e) => {
                if (e.data.type === 'status') {
                    statusText.textContent = `ステータス (Worker ${i+1}): ${e.data.message}`;
                } else if (e.data.type === 'progress') {
                    const currentProgress = parseFloat(progressBar.style.width) || 0;
                    // ★ 修正点: numWorkers -> activeWorkers で割る
                    const newProgress = currentProgress + (e.data.progress * 100 / activeWorkers);
                    progressBar.style.width = `${newProgress}%`;
                } else if (e.data.type === 'complete') {
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    
                    // ★ 修正点: numWorkers -> activeWorkers と比較
                    if (finishedWorkers === activeWorkers) {
                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        progressBar.style.width = '100%';
                        renderMosaic(
                            allResults, 
                            mainImage.width, 
                            mainImage.height, 
                            parseInt(blendRangeInput.value), 
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

            // Workerにデータを送信
            worker.postMessage({ 
                imageData: imageData, 
                tileData: tileData,
                tileSize: tileSize, // 修正: tileSizeInput.value -> tileSize
                width: mainImage.width,
                height: mainImage.height,
                blendOpacity: parseInt(blendRangeInput.value),
                brightnessCompensation: parseInt(brightnessCompensationInput.value),
                textureWeight: parseFloat(textureWeightInput.value) / 100.0,
                startY: startY,
                endY: endY
            });
            
            // 次のWorkerの開始Y座標を更新
            startY += chunkHeight;
        }

        // ★ 修正点: 誰も起動しなかった場合 (画像が小さすぎるなど)
        if (activeWorkers === 0) {
            statusText.textContent = 'ステータス: 画像が小さすぎるか、処理する行がありません。';
            generateButton.disabled = false;
        }
    });

    // --- 4. 最終的なモザイクの描画 ---
    // (クリッピングロジックを含む、前回答のまま)
    async function renderMosaic(results, width, height, blendOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

        // ★ クリッピング設定
        ctx.save(); 
        ctx.beginPath();
        ctx.rect(0, 0, width, height); 
        ctx.clip(); 
        // ★ クリッピング設定ここまで

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
                    // ( ... 明度補正(finalBrightness)の計算 ... )
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;

                    // ( ... 縦長/横長クロップ＆反転描画ロジック ... )
                    const sWidth = img.naturalWidth;
                    const sHeight = img.naturalHeight;
                    const sSize = Math.min(sWidth, sHeight);
                    const isHorizontal = sWidth > sHeight; 
                    const typeParts = tile.patternType.split('_'); 
                    const cropType = typeParts[0]; 
                    const flipType = typeParts[1]; 
                    let sx = 0;
                    let sy = 0;
                    if (isHorizontal) {
                        if (cropType === "cropC") {
                            sx = Math.floor((sWidth - sSize) / 2);
                        } else if (cropType === "cropR") {
                            sx = sWidth - sSize;
                        }
                    } else {
                        if (cropType === "cropM") {
                            sy = Math.floor((sHeight - sSize) / 2);
                        } else if (cropType === "cropB") {
                            sy = sHeight - sSize;
                        }
                    }
                    const dx = tile.x;
                    const dy = tile.y;
                    const dWidth = tile.width; 
                    const dHeight = tile.height; 

                    ctx.save();
                    if (flipType === "flip1") {
                        ctx.scale(-1, 1);
                        ctx.drawImage(img, 
                            sx, sy, sSize, sSize, 
                            -dx - dWidth, dy, dWidth, dHeight 
                        );
                    } else {
                        ctx.drawImage(img, 
                            sx, sy, sSize, sSize, 
                            dx, dy, dWidth, dHeight 
                        );
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

        // --- ブレンド処理 ---
        if (blendOpacity > 0) {
            ctx.globalCompositeOperation = 'multiply'; 
            ctx.globalAlpha = blendOpacity / 100;
            ctx.drawImage(mainImage, 0, 0, width, height);
            ctx.globalCompositeOperation = 'source-over'; 
            ctx.globalAlpha = 1.0; 
        }

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
