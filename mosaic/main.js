document.addEventListener('DOMContentLoaded', async () => {
    // UI要素の取得
    const mainImageInput = document.getElementById('main-image-input');
    const generateButton = document.getElementById('generate-button');
    // ... (他のUI要素取得は変更なし) ...
    const textureWeightValue = document.getElementById('texture-weight-value');

    // ( ... 必須要素チェックは変更なし ... )
    
    const ctx = mainCanvas.getContext('2d');
    let tileData = null;
    let mainImage = null;
    let workers = [];

    // --- UIの初期設定 --- (変更なし)
    generateButton.disabled = true;
    downloadButton.style.display = 'none';

    // ( ... スライダーの値表示リスナーは変更なし ... )

    // --- 1. タイルデータの初期ロード ---
    try {
        statusText.textContent = 'ステータス: tile_data.jsonをロード中...';
        const response = await fetch('tile_data.json');
        if (!response.ok) {
            throw new Error(`tile_data.json のロードに失敗しました (HTTP ${response.status})。Analyzer Appでデータを作成し、/mosaic/フォルダに配置してください。`);
        }
        tileData = await response.json();
        
        // ★ 変更点: 新しいJSON構造 (patterns配列) をチェック
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
    
    // --- 2. メイン画像アップロード --- (変更なし)
    if (mainImageInput) {
        // ( ... 変更なし ... )
    }

    // ★ 変更点: 起動中の全Workerを強制終了するヘルパー関数
    function terminateWorkers() {
        workers.forEach(w => w.terminate());
        workers = [];
    }


    // --- 3. モザイク生成開始 (並列化ロジック) ---
    // (★ この関数全体は、前回実装した並列化ロジックから変更なし)
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
        const chunkHeight = Math.ceil(mainImage.height / numWorkers);
        
        // コア数分だけWorkerを起動するループ
        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker('mosaic_worker.js');
            workers.push(worker);

            const startY = i * chunkHeight;
            const endY = Math.min((i + 1) * chunkHeight, mainImage.height);

            // Workerからのメッセージ受信
            worker.onmessage = (e) => {
                if (e.data.type === 'status') {
                    statusText.textContent = `ステータス (Worker ${i+1}): ${e.data.message}`;
                
                } else if (e.data.type === 'progress') {
                    // 全Workerの平均進捗を表示（簡易的）
                    const currentProgress = parseFloat(progressBar.style.width) || 0;
                    const newProgress = currentProgress + (e.data.progress * 100 / numWorkers);
                    progressBar.style.width = `${newProgress}%`;
                
                } else if (e.data.type === 'complete') {
                    // Workerから返ってきた「部分的な」結果を結合する
                    allResults = allResults.concat(e.data.results);
                    finishedWorkers++;
                    
                    // 全てのWorkerが完了したかチェック
                    if (finishedWorkers === numWorkers) {
                        statusText.textContent = 'ステータス: 全ワーカー処理完了。描画中...';
                        progressBar.style.width = '100%';
                        
                        // 結合した「完全な」結果を描画関数に渡す
                        renderMosaic(
                            allResults, 
                            mainImage.width, 
                            mainImage.height, 
                            parseInt(blendRangeInput.value), 
                            parseInt(brightnessCompensationInput.value)
                        );
                        terminateWorkers(); // 全Workerを終了
                    }
                }
            };

            // Workerでエラーが発生した場合
            worker.onerror = (error) => {
                statusText.textContent = `エラー: Worker ${i+1} で問題が発生しました。 ${error.message}`;
                terminateWorkers(); // 全てのWorkerを停止
                generateButton.disabled = false;
                console.error(`Worker ${i+1} Error:`, error);
            };

            // Workerにデータを送信
            worker.postMessage({ 
                imageData: imageData, 
                tileData: tileData, // 新しいJSON構造のタイルデータ
                tileSize: parseInt(tileSizeInput.value),
                width: mainImage.width,
                height: mainImage.height,
                blendOpacity: parseInt(blendRangeInput.value),
                brightnessCompensation: parseInt(brightnessCompensationInput.value),
                textureWeight: parseFloat(textureWeightInput.value) / 100.0, // 0.0-2.0にスケーリング
                
                // このWorkerの担当範囲（Y座標）を指示
                startY: startY,
                endY: endY
            });
            // imageDataは転送しない (全Workerがコピーを持つ)
        }
    });

    // --- 4. 最終的なモザイクの描画 --- 
    // (★ 前回から変更なし)
    async function renderMosaic(results, width, height, blendOpacity, brightnessCompensation) {
        statusText.textContent = 'ステータス: タイル画像を読み込み、描画中...';
        mainCanvas.width = width;
        mainCanvas.height = height;
        ctx.clearRect(0, 0, width, height);

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
                    // ★ 変更点: tile.l -> tile.tileL に変更 (workerからの返却値に合わせる)
                    let targetL = tile.targetL; 
                    let tileL = tile.tileL; 
                    if (tileL < MIN_TILE_L) tileL = MIN_TILE_L; 
                    let brightnessRatio = targetL / tileL; 
                    if (brightnessRatio > MAX_BRIGHTNESS_RATIO) {
                        brightnessRatio = MAX_BRIGHTNESS_RATIO;
                    }
                    const finalBrightness = (1 - brightnessFactor) + (brightnessFactor * brightnessRatio); 
                    
                    ctx.filter = `brightness(${finalBrightness.toFixed(4)})`;
                    ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height);
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

        // 全タイルのロード（描画）を待つ
        await Promise.all(promises);
        
        progressBar.style.width = '100%';
        statusText.textContent = 'ステータス: タイル描画完了。ブレンド処理中...';


        // --- ブレンド処理 --- (変更なし)
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

    // --- 5. ダウンロード機能 (PNG形式) --- (変更なし)
    downloadButton.addEventListener('click', () => {
        // ( ... 変更なし ... )
    });
});
