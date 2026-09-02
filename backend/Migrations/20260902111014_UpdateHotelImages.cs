using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class UpdateHotelImages : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "image_url",
                table: "hotels");

            migrationBuilder.AddColumn<List<string>>(
                name: "image_urls",
                table: "hotels",
                type: "text[]",
                nullable: false,
                defaultValue: new List<string>());

            migrationBuilder.AddColumn<int>(
                name: "primary_image_index",
                table: "hotels",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "image_urls",
                table: "hotels");

            migrationBuilder.DropColumn(
                name: "primary_image_index",
                table: "hotels");

            migrationBuilder.AddColumn<string>(
                name: "image_url",
                table: "hotels",
                type: "text",
                nullable: true);
        }
    }
}
