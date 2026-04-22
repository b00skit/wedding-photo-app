# Use the official Node.js 20 Alpine image as a base
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on (defaulting to 3000 as per index.js)
EXPOSE 3000

# Set the environment variable for the port to 3000
ENV PORT=3000

# Start the application
CMD ["npm", "start"]
