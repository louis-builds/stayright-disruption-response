using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPolicySourceFile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "source_file_key",
                table: "hotel_refund_policies",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_file_name",
                table: "hotel_refund_policies",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "source_file_key",
                table: "hotel_refund_policies");

            migrationBuilder.DropColumn(
                name: "source_file_name",
                table: "hotel_refund_policies");
        }
    }
}
