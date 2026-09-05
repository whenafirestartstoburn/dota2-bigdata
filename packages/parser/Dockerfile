# syntax=docker/dockerfile:1
# Context is the monorepo root:
#   docker build -f packages/parser/Dockerfile -t parser .
FROM golang:1.25-alpine AS build

WORKDIR /src
COPY packages/parser/go.mod packages/parser/go.sum ./
RUN go mod download
COPY packages/parser/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /parser ./cmd/parser

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget
COPY --from=build /parser /parser
ENV PARSER_PORT=8080
EXPOSE 8080
CMD ["/parser"]
