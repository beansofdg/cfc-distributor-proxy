const { sportsSouthRouter } = require("./routes/sports-south");
app.use("/api/sports-south", authMiddleware, sportsSouthRouter);
