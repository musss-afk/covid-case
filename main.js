document.addEventListener("DOMContentLoaded", function() {
    // --- 1. SETUP ---
    let timer;
    let isPlaying = false;
    let selectedMetric = 'New Cases';
    let allData, nestedData, dateRange, filteredDateRange, geoData, nationalTotalsByDate;

    // Kamus Penerjemah (Tetap)
    const geoJsonToCsvNameMap = {
        "Jakarta Raya": "DKI Jakarta",
        "Yogyakarta": "Daerah Istimewa Yogyakarta",
        "North Kalimantan": "Kalimantan Utara",
        "Bangka-Belitung": "Kepulauan Bangka Belitung"
    };
    function getCsvName(geoJsonName) {
        return geoJsonToCsvNameMap[geoJsonName] || geoJsonName;
    }
    
    // Formatters (Tetap)
    const parseDate = d3.timeParse("%m/%d/%Y");
    const formatDate = d3.timeFormat("%b %d, %Y");
    const formatNumber = d3.format(",.0f");

    // Dimensi (Tetap)
    const mapContainerWidth = 600;
    const mapHeight = 550;
    const contextMargin = { top: 10, right: 20, bottom: 30, left: 50 }; 
    const contextChartWidth = 400; 
    const contextChartHeight = 500; 
    const contextWidth = contextChartWidth - contextMargin.left - contextMargin.right;
    const contextHeight = contextChartHeight - contextMargin.top - contextMargin.bottom;

    // Map SVG (Tetap)
    const svg = d3.select("#map-chart")
        .attr("viewBox", `0 0 ${mapContainerWidth} ${mapHeight}`); 
    const mapGroup = svg.append("g"); 

    // Context (Timeline) SVG (Tetap)
    const contextSvg = d3.select("#context-chart")
        .attr("viewBox", `0 0 ${contextChartWidth} ${contextChartHeight}`)
        .append("g")
        .attr("transform", `translate(${contextMargin.left},${contextMargin.top})`);

    // Elemen Modal (Tetap)
    const modalOverlay = d3.select("#modal-overlay");
    const modalBody = d3.select("#modal-body");
    const modalClose = d3.select("#modal-close");

    // Elemen Legenda (Tetap)
    const legendSvg = d3.select("#legend-chart");
    const legendWidth = 250, legendHeight = 40;

    // Elemen KPI (Tetap)
    const kpiNewCases = d3.select("#kpi-new-cases");
    const kpiNewDeaths = d3.select("#kpi-new-deaths");
    const kpiTotalCases = d3.select("#kpi-total-cases");
    const kpiTotalDeaths = d3.select("#kpi-total-deaths");

    // Scales (Tetap)
    const colorScale = d3.scaleSequential((t) => d3.interpolateRdYlGn(1 - t)).domain([0, 1000]); 
    const contextXScale = d3.scaleTime().range([0, contextWidth]);
    const contextYScale = d3.scaleLinear().range([contextHeight, 0]);

    // UI Elements (Tetap)
    const dateSlider = d3.select("#date-slider");
    const dateDisplay = d3.select("#date-display");
    const playPauseButton = d3.select("#play-pause-button");
    const metricSelect = d3.select("#metric-select");

    // Proyeksi Peta (Tetap)
    const projection = d3.geoMercator()
        .center([118, -2]) 
        .scale(1100)
        .translate([mapContainerWidth / 2, mapHeight / 2]);
    const path = d3.geoPath().projection(projection);

    // --- 2. DATA LOADING & PROCESSING (Tetap) ---
    Promise.all([
        d3.csv("covid_indonesia_province_cleaned.csv", d => {
            d.Date = parseDate(d.Date);
            d['New Cases'] = +d['New Cases'];
            d['New Deaths'] = +d['New Deaths'];
            d['Total Cases'] = +d['Total Cases'];
            d['Total Deaths'] = +d['Total Deaths'];
            d['Total Recovered'] = +d['Total Recovered'];
            d.Province = d.Province.trim();
            return d;
        }),
        d3.json("indonesia-provinces.json") 
    ]).then(([covidData, indonesiaGeo]) => {
        allData = covidData;
        geoData = indonesiaGeo; 
        
        nestedData = d3.group(allData, d => d.Date);
        dateRange = Array.from(nestedData.keys()).sort(d3.ascending);
        filteredDateRange = dateRange;
        
        dataByProvinceByDate = new Map();
        nationalTotalsByDate = new Map();

        for (let [date, values] of nestedData.entries()) {
            const provinceMap = new Map();
            let dayTotals = { 'New Cases': 0, 'New Deaths': 0, 'Total Cases': 0, 'Total Deaths': 0 };
            
            for (let row of values) {
                provinceMap.set(row.Province, row);
                dayTotals['New Cases'] += row['New Cases'];
                dayTotals['New Deaths'] += row['New Deaths'];
                dayTotals['Total Cases'] += row['Total Cases'];
                dayTotals['Total Deaths'] += row['Total Deaths'];
            }
            dataByProvinceByDate.set(date, provinceMap);
            nationalTotalsByDate.set(date, dayTotals);
        }
        
        dateSlider.attr("max", dateRange.length - 1);
        
        updateColorScale();
        setupContextChart(); 
        drawMap(); 
        update(0); 

        // --- 3. EVENT LISTENERS (Tetap) ---
        playPauseButton.on("click", togglePlay);
        dateSlider.on("input", () => update(+dateSlider.property("value")));
        metricSelect.on("change", () => {
            selectedMetric = metricSelect.property("value");
            updateContextChart(); 
            updateColorScale(); 
            update(+dateSlider.property("value"));
        });
        
        modalClose.on("click", hideModal);
        modalOverlay.on("click", function(event) {
            if (event.target === this) {
                hideModal();
            }
        });

    }).catch(error => {
        console.error("Error loading data:", error);
    });

    // --- 4. MAP DRAWING & ZOOM (Tetap) ---
    function drawMap() {
        mapGroup.selectAll("path.province")
            .data(geoData.features)
            .enter()
            .append("path")
            .attr("class", "province")
            .attr("d", path)
            .attr("fill", "#444") 
            .on("click", (event, d) => {
                const geoJsonName = d.properties.name; 
                const csvName = getCsvName(geoJsonName); 
                const currentDate = filteredDateRange[+dateSlider.property("value")];
                const provinceData = dataByProvinceByDate.get(currentDate)?.get(csvName);
                
                showModal(geoJsonName, currentDate, provinceData);
            });
            
        const zoom = d3.zoom()
            .scaleExtent([1, 8]) 
            .on("zoom", (event) => {
                mapGroup.attr("transform", event.transform);
            });
        svg.call(zoom);
    }
    
    // --- 5. FUNGSI MODAL (Tetap) ---
    function showModal(provinceName, date, data) {
        if (isPlaying) {
            togglePlay(); // Jeda animasi
        }
        
        let content = `<h2>${provinceName}</h2>`;
        content += `<p class="date">${formatDate(date)}</p>`;
        
        if (data) {
            content += `
                <p class="new-cases">Kasus Baru: <span>${formatNumber(data['New Cases'])}</span></p>
                <p class="new-deaths">Kematian Baru: <span>${formatNumber(data['New Deaths'])}</span></p>
                <hr style="border: none; border-top: 1px solid #444; margin: 15px 0;">
                <p>Total Kasus: <span>${formatNumber(data['Total Cases'])}</span></p>
                <p>Total Kematian: <span>${formatNumber(data['Total Deaths'])}</span></p>
                <p>Total Sembuh: <span>${formatNumber(data['Total Recovered'])}</span></p>
            `;
        } else {
            content += `<p>Tidak ada data untuk tanggal ini.</p>`;
        }
        
        modalBody.html(content);
        modalOverlay.classed("visible", true);
    }

    function hideModal() {
        modalOverlay.classed("visible", false);
    }
    // ---------------------------------------

    
    // --- 6. CONTEXT CHART (Grafik Garis/Area) (Tetap) ---
    function setupContextChart() {
        const weeklyTotals = d3.rollups(allData, v => d3.sum(v, d => d[selectedMetric]), d => d3.timeWeek.floor(d.Date))
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => a.date - b.date);

        contextXScale.domain(d3.extent(weeklyTotals, d => d.date));
        contextYScale.domain([0, d3.max(weeklyTotals, d => d.value)]);

        contextSvg.append("g").attr("class", "context-axis").attr("transform", `translate(0,${contextHeight})`).call(d3.axisBottom(contextXScale).ticks(d3.timeYear.every(1)));
        contextSvg.append("g").attr("class", "context-y-axis").call(d3.axisLeft(contextYScale).ticks(5).tickFormat(d3.format("~s")));
        contextSvg.append("text").attr("class", "y-axis-label").attr("transform", "rotate(-90)").attr("y", 0 - contextMargin.left).attr("x", 0 - (contextHeight / 2)).attr("dy", "1em").text(selectedMetric);

        const defs = contextSvg.append("defs");
        const areaGradient = defs.append("linearGradient")
            .attr("id", "area-gradient")
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "0%").attr("y2", "100%");
        
        areaGradient.append("stop").attr("offset", "0%").attr("stop-color", "#007bff").attr("stop-opacity", 0.8);
        areaGradient.append("stop").attr("offset", "100%").attr("stop-color", "#007bff").attr("stop-opacity", 0);

        const areaGenerator = d3.area()
            .x(d => contextXScale(d.date))
            .y0(contextHeight)
            .y1(d => contextYScale(d.value));
        
        const lineGenerator = d3.line()
            .x(d => contextXScale(d.date))
            .y(d => contextYScale(d.value));

        contextSvg.append("path")
            .datum(weeklyTotals)
            .attr("class", "context-area")
            .attr("d", areaGenerator);

        contextSvg.append("path")
            .datum(weeklyTotals)
            .attr("class", "context-line")
            .attr("d", lineGenerator);
            
        // Anotasi (Tetap)
        const annotations = [{ date: "2021-07-15", label: "Puncak Delta" }, { date: "2022-02-15", label: "Puncak Omicron" }];
        annotations.forEach(ann => {
            const xPos = contextXScale(parseDate(ann.date.replace(/-/g, '/')));
            const g = contextSvg.append("g");
            g.append("line").attr("class", "annotation-line").attr("x1", xPos).attr("x2", xPos).attr("y1", 0).attr("y2", contextHeight);
            g.append("text").attr("class", "annotation-text").attr("x", xPos).attr("y", 10).text(ann.label);
        });

        // Brush (Tetap)
        const brush = d3.brushX().extent([[0, 0], [contextWidth, contextHeight]]).on("end", brushed);
        contextSvg.append("g").attr("class", "brush").call(brush);

        function brushed({ selection }) {
            if (selection) {
                const [x0, x1] = selection.map(contextXScale.invert);
                filteredDateRange = dateRange.filter(d => d >= x0 && d <= x1);
            } else {
                filteredDateRange = dateRange;
            }
            dateSlider.attr("max", filteredDateRange.length - 1);
            dateSlider.property("value", 0);
            updateColorScale(); 
            update(0);
            hideModal(); 
        }
    }
    
    // --- 7. UPDATE CONTEXT CHART (Tetap) ---
    function updateContextChart() {
        hideModal();
        
        const weeklyTotals = d3.rollups(allData, v => d3.sum(v, d => v[selectedMetric]), d => d3.timeWeek.floor(d.Date))
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => a.date - b.date);
        
        contextYScale.domain([0, d3.max(weeklyTotals, d => d.value)]);
        contextSvg.select(".context-y-axis").transition().duration(500).call(d3.axisLeft(contextYScale).ticks(5).tickFormat(d3.format("~s")));
        contextSvg.select(".y-axis-label").text(selectedMetric);
            
        const areaGenerator = d3.area()
            .x(d => contextXScale(d.date))
            .y0(contextHeight)
            .y1(d => contextYScale(d.value));
            
        contextSvg.select(".context-area")
            .datum(weeklyTotals)
            .transition().duration(500)
            .attr("d", areaGenerator);

        const lineGenerator = d3.line()
            .x(d => contextXScale(d.date))
            .y(d => contextYScale(d.value));
            
        contextSvg.select(".context-line")
            .datum(weeklyTotals)
            .transition().duration(500)
            .attr("d", lineGenerator);
    }
    
    // --- 8. FUNGSI LEGENDA & UPDATE ---
    
    function drawLegend(scale) {
        legendSvg.selectAll("*").remove();
        const legendGradientId = "legend-gradient";
        const defs = legendSvg.append("defs");
        const linearGradient = defs.append("linearGradient")
            .attr("id", legendGradientId)
            .attr("x1", "0%").attr("y1", "0%")
            .attr("x2", "100%").attr("y2", "0%");

        linearGradient.append("stop").attr("offset", "0%").attr("stop-color", d3.interpolateRdYlGn(1)); // Hijau
        linearGradient.append("stop").attr("offset", "50%").attr("stop-color", d3.interpolateRdYlGn(0.5)); // Kuning
        linearGradient.append("stop").attr("offset", "100%").attr("stop-color", d3.interpolateRdYlGn(0)); // Merah

        legendSvg.append("rect")
            .attr("x", 10)
            .attr("y", 0)
            .attr("width", legendWidth - 20)
            .attr("height", 20)
            .style("fill", `url(#${legendGradientId})`);

        const legendScale = d3.scaleLinear()
            .domain(scale.domain())
            .range([10, legendWidth - 10]);

        legendSvg.append("g")
            .attr("class", "legend-axis")
            .attr("transform", `translate(0, 20)`)
            .call(d3.axisBottom(legendScale).ticks(3).tickFormat(d3.format("~s")));
    }

    function updateColorScale() {
        let maxVal = 0;
        let dataToScan = (filteredDateRange.length > 0) ? filteredDateRange : dateRange;
        for (const date of dataToScan) {
            const dailyData = nestedData.get(date);
            if (dailyData) {
                const dailyMax = d3.max(dailyData, d => d[selectedMetric]);
                // --- === INI ADALAH PERBAIKANNYA === ---
                if (dailyMax > maxVal) maxVal = dailyMax; // Menghapus titik ekstra
                // ------------------------------------
            }
        }
        colorScale.domain([0, maxVal > 0 ? maxVal : 1]);
        drawLegend(colorScale);
    }

    // --- 9. UPDATE UTAMA (KPI) (Tetap) ---
    function update(dateIndex) {
        if (!filteredDateRange || filteredDateRange.length === 0) return;
        
        const currentDate = filteredDateRange[dateIndex];
        dateDisplay.text(formatDate(currentDate));
        dateSlider.property("value", dateIndex);
        
        if (isPlaying) {
            hideModal();
        }

        const totals = nationalTotalsByDate.get(currentDate);
        if (totals) {
            kpiNewCases.text(formatNumber(totals['New Cases']));
            kpiNewDeaths.text(formatNumber(totals['New Deaths']));
            kpiTotalCases.text(formatNumber(totals['Total Cases']));
            kpiTotalDeaths.text(formatNumber(totals['Total Deaths']));
        }

        const currentDataByProvince = dataByProvinceByDate.get(currentDate);
        if (!currentDataByProvince) return; 
        
        mapGroup.selectAll("path.province")
            .transition()
            .duration(isPlaying ? 150 : 0) 
            .attr("fill", d => {
                const geoJsonName = d.properties.name;
                const csvName = getCsvName(geoJsonName);
                const provinceData = currentDataByProvince.get(csvName); 
                if (provinceData) {
                    return colorScale(provinceData[selectedMetric]);
                } else {
                    return "#444"; 
                }
            });
    }

    // --- 10. KONTROL ANIMASI (Tetap) ---
    function togglePlay() {
        if (isPlaying) {
            clearInterval(timer);
            playPauseButton.text("Play");
        } else {
            hideModal();
            playPauseButton.text("Pause");
            timer = setInterval(() => {
                let currentValue = +dateSlider.property("value");
                let maxValue = +dateSlider.attr("max");
                if (currentValue < maxValue) {
                    currentValue++;
                    update(currentValue);
                } else {
                    clearInterval(timer);
                    isPlaying = false;
                    playPauseButton.text("Play");
                }
            }, 150); 
        }
        isPlaying = !isPlaying;
    }
});