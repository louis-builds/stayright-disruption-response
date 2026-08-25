using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDisruptionHandoffFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "event_subtype",
                table: "disruptions",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "lat",
                table: "disruptions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "lng",
                table: "disruptions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "radius_km",
                table: "disruptions",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "raw_signal_json",
                table: "disruptions",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "severity",
                table: "disruptions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "event_subtype",
                table: "disruptions");

            migrationBuilder.DropColumn(
                name: "lat",
                table: "disruptions");

            migrationBuilder.DropColumn(
                name: "lng",
                table: "disruptions");

            migrationBuilder.DropColumn(
                name: "radius_km",
                table: "disruptions");

            migrationBuilder.DropColumn(
                name: "raw_signal_json",
                table: "disruptions");

            migrationBuilder.DropColumn(
                name: "severity",
                table: "disruptions");
        }
    }
}
